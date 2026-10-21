#!/usr/bin/env python3
"""The MAWS arm's queue on the Mac mini (mini/, findings.txt §7a), run here with a stand-in for the bench's invocation
and no launchd: the LaunchAgent it renders, one repetition handed over and answered with its own exit code and the
bench's flags, a key that is not the bench's refused, values kept whole, requests taken in order, and the stop.
Run: python3 -I spikes/p4-parity-bench/mini_test.py"""
import os
import plistlib
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
RUNNER = os.path.join(HERE, 'mini', 'queue-runner.sh')
WRAPPER = os.path.join(HERE, 'mini', 'bench-queue.sh')
# The stand-in for the bench's playwright invocation: the repetition's environment, then an exit code it names.
FAKE = 'env | grep "^MAWS_" | sort; exit ${MAWS_BENCH_REPS:-0}'


class Queue(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.run_dir = os.path.join(self.dir, 'run')
        self.queue = os.path.join(self.run_dir, 'queue')
        self.env = dict(os.environ, BENCH_LAUNCHCTL='/usr/bin/true', BENCH_RUN_TIMEOUT='30', BENCH_NODE_DIR='/opt/node22/bin')
        self.runner = None

    def tearDown(self):
        if self.runner and self.runner.poll() is None:
            self.runner.kill()
            self.runner.wait()
        shutil.rmtree(self.dir)

    def start_runner(self):
        """The runner as launchd would start it, here as a child process."""
        self.runner = subprocess.Popen(['/bin/zsh', RUNNER, self.queue], env=dict(self.env, BENCH_QUEUE_CMD=FAKE, BENCH_REPO=self.dir),
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(50):
            if os.path.exists(os.path.join(self.queue, 'heartbeat')):
                return
            time.sleep(0.1)
        self.fail('the runner did not start')

    def wrapper(self, *args):
        return subprocess.run(['/bin/zsh', WRAPPER, *args], env=self.env, capture_output=True, text=True, timeout=60)

    def test_the_launch_agent_it_renders(self):
        res = self.wrapper('plist', self.run_dir)
        self.assertEqual(res.returncode, 0, res.stderr)
        with open(os.path.join(self.queue, 'queue.plist'), 'rb') as f:
            agent = plistlib.load(f)
        self.assertEqual(agent['Label'], 'com.ssfskim.maws-bench.queue')
        self.assertEqual(agent['ProgramArguments'], ['/bin/zsh', RUNNER, os.path.realpath(self.queue)])
        self.assertTrue(agent['EnvironmentVariables']['PATH'].startswith('/opt/node22/bin:'))
        self.assertEqual((agent['ProcessType'], agent['LimitLoadToSessionType'], agent['RunAtLoad'], agent['KeepAlive']), ('Interactive', 'Aqua', True, False))
        self.assertTrue(agent['StandardErrorPath'].startswith(os.path.realpath(self.queue)))

    def test_one_repetition_answered_with_its_code_and_the_benchs_flags(self):
        self.start_runner()
        res = self.wrapper('run', self.run_dir, 'MAWS_BENCH_TASKS=B3', 'MAWS_BENCH_REP_FROM=2', 'MAWS_BENCH_REPS=3', 'MAWS_BENCH_OUT=/tmp/a run dir')
        self.assertEqual(res.returncode, 3, res.stdout + res.stderr)
        for line in ('MAWS_BENCH_TASKS=B3', 'MAWS_BENCH_REP_FROM=2', 'MAWS_BENCH_OUT=/tmp/a run dir', 'MAWS_LIVE=1', 'MAWS_HARNESS=0', 'MAWS_E2E_QUIET=1'):
            self.assertIn(line + '\n', res.stdout)
        ok = self.wrapper('run', self.run_dir, 'MAWS_BENCH_TASKS=B1')
        self.assertEqual(ok.returncode, 0, ok.stdout)
        with open(os.path.join(self.queue, 'runner.log')) as f:
            log = f.read()
        self.assertLess(log.index('MAWS_BENCH_TASKS=B3'), log.index('MAWS_BENCH_TASKS=B1'))

    def test_a_key_that_is_not_the_benchs_is_refused(self):
        self.start_runner()
        res = self.wrapper('run', self.run_dir, 'MAWS_BENCH_TASKS=B1', 'CLAUDE_CONFIG_DIR=/tmp/x')
        self.assertEqual(res.returncode, 2)
        self.assertIn("refused: not the bench's keys: CLAUDE_CONFIG_DIR", res.stdout)

    def test_a_request_with_no_runner_fails_at_once(self):
        res = self.wrapper('run', self.run_dir, 'MAWS_BENCH_TASKS=B1')
        self.assertEqual(res.returncode, 1)
        self.assertIn('no runner', res.stdout)

    def test_requests_queued_before_the_runner_are_taken_oldest_first(self):
        os.makedirs(self.queue)
        for name, task in (('20261021T120000-1', 'B7'), ('20261021T115959-1', 'B5')):
            with open(os.path.join(self.queue, name + '.req'), 'w') as f:
                f.write('MAWS_BENCH_TASKS=%s\n' % task)
        self.start_runner()
        for _ in range(100):
            if os.path.exists(os.path.join(self.queue, '20261021T120000-1.done')):
                break
            time.sleep(0.1)
        with open(os.path.join(self.queue, 'runner.log')) as f:
            log = f.read()
        self.assertLess(log.index('MAWS_BENCH_TASKS=B5'), log.index('MAWS_BENCH_TASKS=B7'))

    def test_stop_ends_the_runner(self):
        self.start_runner()
        self.assertIn('runner up', self.wrapper('status', self.run_dir).stdout)
        res = self.wrapper('stop', self.run_dir)
        self.assertEqual(res.returncode, 0, res.stdout)
        self.assertEqual(self.runner.wait(timeout=10), 0)
        self.assertFalse(os.path.exists(os.path.join(self.queue, 'runner.pid')))
        self.assertIn('no runner', self.wrapper('status', self.run_dir).stdout)


if __name__ == '__main__':
    unittest.main()
