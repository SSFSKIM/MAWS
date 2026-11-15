// UX wave U11g (docs/doperpowers/plans/2026-11-14-ux-wave-U11g-custom-connector.md, §A "The names the engine empties";
// Engine facts, 6): the `${NAME}` references Claude Code 2.1.322 reads as empty toward a remote server. The five names
// the probe's pass 3 recorded as emptied (spikes/protocol-probe/fixtures/uxwave/u11-connector-scope3.ndjson, line 2,
// `remote`) are found bare and with a fallback, in a header's value and in a URL; the names it recorded as received
// answer nothing.
import { describe, expect, it } from 'vitest';
import { REMOTE_EMPTIED_NAMES, remoteEmptiedNamesIn } from './remote-emptied-names';

const RECORDED_EMPTIED = ['NPM_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'ANTHROPIC_API_KEY', 'HTTPS_PROXY', 'OTEL_EXPORTER_OTLP_HEADERS'];

describe('remoteEmptiedNamesIn', () => {
  it.each(RECORDED_EMPTIED)('finds %s bare and with a fallback, in a header value and in a URL', (name) => {
    expect(remoteEmptiedNamesIn(`\${${name}}`)).toEqual([name]);
    expect(remoteEmptiedNamesIn(`token \${${name}:-value-one}`)).toEqual([name]);
    expect(remoteEmptiedNamesIn(`https://files.example.test/mcp?key=\${${name}}`)).toEqual([name]);
    expect(remoteEmptiedNamesIn(`https://files.example.test/\${${name}:-path}/mcp`)).toEqual([name]);
  });

  it('reads a name in lower case, or under the INPUT_ prefix, as the engine does, and answers it as written', () => {
    expect(remoteEmptiedNamesIn('${npm_token}')).toEqual(['npm_token']);
    expect(remoteEmptiedNamesIn('${Https_Proxy}')).toEqual(['Https_Proxy']);
    expect(remoteEmptiedNamesIn('${INPUT_NPM_TOKEN}')).toEqual(['INPUT_NPM_TOKEN']);
    expect(remoteEmptiedNamesIn('${otel_service_name}')).toEqual(['otel_service_name']); // any name beginning OTEL_
  });

  it('answers nothing for a name of the person’s own, credential-looking or not, and for GITHUB_TOKEN and GH_TOKEN', () => {
    for (const text of ['${MYSERVICE_TOKEN}', '${FILES_PROBE_KEY}', '${GITHUB_TOKEN}', '${GH_TOKEN}', '${HF_TOKEN}']) expect(remoteEmptiedNamesIn(text), text).toEqual([]);
  });

  it('answers each name once, in the order met; a text with no reference, or a malformed one, answers nothing', () => {
    expect(remoteEmptiedNamesIn('${NPM_TOKEN}/${MYSERVICE_TOKEN}/${HTTPS_PROXY}/${NPM_TOKEN}')).toEqual(['NPM_TOKEN', 'HTTPS_PROXY']);
    for (const text of ['', 'value-one', '$NPM_TOKEN', '${NPM_TOKEN', '{NPM_TOKEN}', '${1NPM_TOKEN}', '${NPM-TOKEN}']) expect(remoteEmptiedNamesIn(text), text).toEqual([]);
  });

  it('holds the 132 names of the engine’s four lists, in upper case, the five GitHub-enterprise and Hugging Face names left out', () => {
    expect(REMOTE_EMPTIED_NAMES.size).toBe(132);
    for (const name of REMOTE_EMPTIED_NAMES) expect(name, name).toBe(name.toUpperCase());
    for (const name of RECORDED_EMPTIED.filter((n) => !n.startsWith('OTEL_'))) expect(REMOTE_EMPTIED_NAMES.has(name), name).toBe(true);
    for (const name of ['GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'HF_TOKEN', 'HUGGING_FACE_HUB_TOKEN', 'HUGGINGFACEHUB_API_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN']) expect(REMOTE_EMPTIED_NAMES.has(name), name).toBe(false);
  });
});
