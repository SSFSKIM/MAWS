#!/usr/bin/env python3
"""The MAWS arm's queue on the Mac mini (mini/, findings.txt §7a), run here with a stand-in for the bench's invocation
and one for launchctl: the LaunchAgent it renders, one repetition handed over and answered with its own exit code and
the bench's flags, a key that is not the bench's or a request without the required ones refused, values kept whole,
requests taken in order, the wrapper's own exits (124, 125) apart from the repetition's, a stale runner.pid, and the
stop, which ends a repetition only when forced.
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
SLOW = 'sleep 30'  # a repetition still running
REQUIRED = ('MAWS_BENCH_SCOPE=owner', 'MAWS_BENCH_OUT=/tmp/a run dir')
# launchctl's stand-in: each call logged; a bootout ends the runner as launchd's would, with TERM to its process.
LAUNCHCTL = """#!/bin/sh
echo "$*" >> '%(log)s'
if [ "$1" = bootout ] && [ -f '%(queue)s/runner.pid' ]; then kill -TERM "$(cat '%(queue)s/runner.pid')" 2>/dev/null; fi
exit 0
"""


class Queue(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.run_dir = os.path.join(self.dir, 'run')
        self.queue = os.path.join(self.run_dir, 'queue')
        self.launchctl_log = os.path.join(self.dir, 'launchctl.log')
        launchctl = os.path.join(self.dir, 'launchctl')
        with open(launchctl, 'w') as f:
            f.write(LAUNCHCTL % dict(log=self.launchctl_log, queue=os.path.realpath(self.queue)))
        os.chmod(launchctl, 0o755)
        self.env = dict(os.environ, BENCH_LAUNCHCTL=launchctl, BENCH_RUN_TIMEOUT='30', BENCH_NODE_DIR='/opt/node22/bin')
        self.runner = None
        self.others = []  # waiting wrappers and stand-in processes, ended with the test

    def tearDown(self):
        for p in [self.runner] + self.others:
            if p and p.poll() is None:
                p.terminate()  # the runner's trap ends the repetition in hand
                try:
                    p.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    p.kill()
                    p.wait()
            if p and p.stdout:
                p.stdout.close()
        shutil.rmtree(self.dir)

    def start_runner(self, cmd=FAKE):
        """The runner as launchd would start it, here as a child process."""
        self.runner = subprocess.Popen(['/bin/zsh', RUNNER, self.queue], env=dict(self.env, BENCH_QUEUE_CMD=cmd, BENCH_REPO=self.dir),
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(50):
            if os.path.exists(os.path.join(self.queue, 'heartbeat')):
                return
            time.sleep(0.1)
        self.fail('the runner did not start')

    def wrapper(self, *args, **env):
        return subprocess.run(['/bin/zsh', WRAPPER, *args], env=dict(self.env, **env), capture_output=True, text=True, timeout=60)

    def waiting_run(self, state='.run'):
        """A `run` left waiting, returned once its request is in the queue as `state`: '.run' taken by the runner (a
        slow repetition), '.req' still queued behind another."""
        mine = lambda: {n.rsplit('.', 1)[0] for n in os.listdir(self.queue) if n.endswith(('.req', '.run'))}
        before = mine()
        p = subprocess.Popen(['/bin/zsh', WRAPPER, 'run', self.run_dir, 'MAWS_BENCH_TASKS=B1', *REQUIRED], env=self.env,
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        self.others.append(p)
        for _ in range(100):
            if any(os.path.exists(os.path.join(self.queue, base + state)) for base in mine() - before):
                return p
            time.sleep(0.1)
        self.fail('the request never reached %s' % state)

    def bootouts(self):
        if not os.path.exists(self.launchctl_log):
            return []
        with open(self.launchctl_log) as f:
            return [line for line in f.read().splitlines() if line.startswith('bootout')]

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

    def test_the_newest_nvm_node_22_by_number(self):
        home = os.path.join(self.dir, 'home')
        for v in ('v22.9.0', 'v22.18.0', 'v22.2.0'):
            os.makedirs(os.path.join(home, '.nvm', 'versions', 'node', v, 'bin'))
        env = {k: v for k, v in self.env.items() if k != 'BENCH_NODE_DIR'}
        res = subprocess.run(['/bin/zsh', WRAPPER, 'plist', self.run_dir], env=dict(env, HOME=home), capture_output=True, text=True, timeout=60)
        self.assertEqual(res.returncode, 0, res.stderr)
        with open(os.path.join(self.queue, 'queue.plist'), 'rb') as f:
            path = plistlib.load(f)['EnvironmentVariables']['PATH']
        self.assertTrue(path.startswith(os.path.join(home, '.nvm', 'versions', 'node', 'v22.18.0', 'bin') + ':'), path)

    def test_one_repetition_answered_with_its_code_and_the_benchs_flags(self):
        self.start_runner()
        res = self.wrapper('run', self.run_dir, 'MAWS_BENCH_TASKS=B3', 'MAWS_BENCH_REP_FROM=2', 'MAWS_BENCH_REPS=3', *REQUIRED)
        self.assertEqual(res.returncode, 3, res.stdout + res.stderr)
        for line in ('MAWS_BENCH_TASKS=B3', 'MAWS_BENCH_REP_FROM=2', 'MAWS_BENCH_OUT=/tmp/a run dir', 'MAWS_BENCH_SCOPE=owner', 'MAWS_LIVE=1', 'MAWS_HARNESS=0',
                     'MAWS_E2E_QUIET=1'):
            self.assertIn(line + '\n', res.stdout)
        ok = self.wrapper('run', self.run_dir, 'MAWS_BENCH_TASKS=B1', *REQUIRED)
        self.assertEqual(ok.returncode, 0, ok.stdout)
        with open(os.path.join(self.queue, 'runner.log')) as f:
            log = f.read()
        self.assertLess(log.index('MAWS_BENCH_TASKS=B3'), log.index('MAWS_BENCH_TASKS=B1'))

    def test_a_request_names_its_checkout_and_variant(self):
        """P4-A3: two builds' arms interleave through one runner, each request naming the checkout it runs in and the
        lever its manifest records; a checkout that is not the bench's is refused, and the default stays the runner's."""
        other = os.path.join(self.dir, 'lever')
        os.makedirs(os.path.join(other, 'e2e'))
        open(os.path.join(other, 'e2e', 'bench-edit-live.spec.ts'), 'w').close()
        self.start_runner('pwd -P; ' + FAKE)
        res = self.wrapper('run', self.run_dir, 'MAWS_BENCH_TASKS=B3', 'MAWS_BENCH_REPO=' + other, 'MAWS_BENCH_VARIANT=alwaysLoad', *REQUIRED)
        self.assertEqual(res.returncode, 0, res.stdout)
        self.assertIn('MAWS_BENCH_VARIANT=alwaysLoad\n', res.stdout)
        self.assertEqual(res.stdout.strip().splitlines()[0], os.path.realpath(other))
        self.assertNotIn('MAWS_BENCH_REPO=', res.stdout)  # the checkout is where it runs, not a key the bench reads
        plain = self.wrapper('run', self.run_dir, 'MAWS_BENCH_TASKS=B3', *REQUIRED)
        self.assertEqual(plain.stdout.strip().splitlines()[0], os.path.realpath(self.dir))
        bad = self.wrapper('run', self.run_dir, 'MAWS_BENCH_TASKS=B3', 'MAWS_BENCH_REPO=' + self.run_dir, *REQUIRED)
        self.assertEqual(bad.returncode, 2, bad.stdout)
        self.assertIn('refused: MAWS_BENCH_REPO', bad.stdout)

    def test_a_key_that_is_not_the_benchs_is_refused(self):
        self.start_runner()
        res = self.wrapper('run', self.run_dir, 'MAWS_BENCH_TASKS=B1', *REQUIRED, 'CLAUDE_CONFIG_DIR=/tmp/x')
        self.assertEqual(res.returncode, 2)
        self.assertIn("refused: not the bench's keys: CLAUDE_CONFIG_DIR", res.stdout)

    def test_a_request_without_the_required_keys_is_refused(self):
        """With no task, run directory or scope the bench would run on its own defaults: nothing is handed over."""
        self.start_runner()
        for args, lacks in (((), 'MAWS_BENCH_TASKS MAWS_BENCH_OUT MAWS_BENCH_SCOPE'), (('MAWS_BENCH_TASKS=B1', 'MAWS_BENCH_OUT='), 'MAWS_BENCH_OUT MAWS_BENCH_SCOPE')):
            with self.subTest(args=args):
                res = self.wrapper('run', self.run_dir, *args)
                self.assertEqual(res.returncode, 2, res.stdout)
                self.assertIn('refused: the request lacks %s' % lacks, res.stdout)
        self.assertEqual([n for n in os.listdir(self.queue) if n.endswith(('.req', '.run'))], [])

    def test_a_request_with_no_runner_fails_at_once(self):
        res = self.wrapper('run', self.run_dir, 'MAWS_BENCH_TASKS=B1', *REQUIRED)
        self.assertEqual(res.returncode, 125)
        self.assertIn('no runner', res.stdout)

    def test_no_answer_in_time_is_124_and_a_runner_gone_125(self):
        """The wrapper's own failures never read as a failed repetition's 1."""
        self.start_runner(SLOW)
        res = self.wrapper('run', self.run_dir, 'MAWS_BENCH_TASKS=B1', *REQUIRED, BENCH_RUN_TIMEOUT='2')
        self.assertEqual(res.returncode, 124, res.stdout)
        self.assertIn('no answer', res.stdout)
        waiting = self.waiting_run('.req')  # the slow one still in hand: this one waits behind it
        self.runner.terminate()
        self.assertEqual(self.runner.wait(timeout=5), 143)
        self.assertFalse(os.path.exists(os.path.join(self.queue, 'runner.pid')), 'TERM removes runner.pid')
        self.assertEqual(waiting.wait(timeout=10), 125)
        self.assertIn('the runner stopped before answering', waiting.stdout.read())

    def test_a_stale_pid_is_no_runner(self):
        """A runner.pid a killed runner left, naming another live process now."""
        other = subprocess.Popen(['/bin/sleep', '30'])
        self.others.append(other)
        os.makedirs(self.queue)
        with open(os.path.join(self.queue, 'runner.pid'), 'w') as f:
            f.write('%d\n' % other.pid)
        self.assertIn('no runner', self.wrapper('status', self.run_dir).stdout)
        res = self.wrapper('run', self.run_dir, 'MAWS_BENCH_TASKS=B1', *REQUIRED)
        self.assertEqual(res.returncode, 125, res.stdout)
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
        self.assertEqual(len(self.bootouts()), 1)

    def test_stop_ends_a_repetition_only_when_forced(self):
        self.start_runner(SLOW)
        waiting = self.waiting_run()
        res = self.wrapper('stop', self.run_dir, BENCH_STOP_TIMEOUT='2')
        self.assertEqual(res.returncode, 1, res.stdout)
        self.assertIn('not booted out', res.stdout)
        self.assertEqual(self.bootouts(), [])
        self.assertIsNone(self.runner.poll(), 'the repetition runs on')
        forced = self.wrapper('stop', self.run_dir, '--force', BENCH_STOP_TIMEOUT='0')
        self.assertEqual((forced.returncode, forced.stdout.strip()), (0, 'runner stopped'), forced.stdout)
        self.assertEqual(len(self.bootouts()), 1)
        self.assertEqual(self.runner.wait(timeout=5), 143)
        self.assertEqual(waiting.wait(timeout=10), 125)


if __name__ == '__main__':
    unittest.main()
