// D14 §6, the check: the canon's structure (D6's `validateCanon`, with the page's parser; a host without one stores
// canon unchecked, Decision Log 26) and the law's tagged hard don'ts run over the system's own canon (M2's
// `checkHardDonts`), listing each file problem and each violation where it is, the rules that passed, the don'ts left
// to judgment, and the tags MAWS cannot run.
import type { Ref } from 'react';
import { canonUnits, validateCanon, type CanonProblem, type HtmlParser } from '../canon';
import { checkHardDonts } from '../check';
import { parseLaw } from '../law';
import type { TokenSet } from '../tokens';

export function checkCanon(law: string, tokens: TokenSet, files: Readonly<Record<string, string>>, parser: HtmlParser) {
  const parsed = parseLaw(law);
  return { donts: parsed.donts, report: checkHardDonts(parsed, tokens, canonUnits(files, parser)), problems: validateCanon(files, parser, tokens) };
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One line for the check: the canon's file problems and the rules' violations, else that the canon keeps every rule;
 * none when there is nothing to report and no rule to check. */
function summaryOf(problems: readonly CanonProblem[], report: ReturnType<typeof checkHardDonts>, hasDonts: boolean): string | null {
  const broken = report.checks.filter((c) => c.violations).length;
  const parts = [
    ...(problems.length ? [`${count(problems.length, 'file problem', 'file problems')} in the canon`] : []),
    ...(report.violations.length ? [`${count(report.violations.length, 'violation', 'violations')} of ${count(broken, 'checked rule', 'checked rules')}`] : []),
  ];
  if (parts.length) return `${parts.join('; ')}.`;
  return hasDonts ? `The canon keeps every checked rule (${report.checks.length}).` : null;
}

export function Check(props: { law: string; tokens: TokenSet; files: Readonly<Record<string, string>>; parser: HtmlParser; sectionRef?: Ref<HTMLElement> }) {
  const { donts, report, problems } = checkCanon(props.law, props.tokens, props.files, props.parser);
  const summary = summaryOf(problems, report, donts.length > 0);
  const words = (index: number) => donts.find((dont) => dont.index === index)?.text ?? '';
  return (
    <section ref={props.sectionRef} className="dsp-section" data-ds-section="check" aria-labelledby="dsp-check" tabIndex={-1}>
      <h2 id="dsp-check" className="dsp-heading">
        Check against law
      </h2>
      {summary === null ? null : <p className="dsp-summary">{summary}</p>}
      {problems.length ? (
        <ul className="dsp-violations" aria-label="File problems">
          {problems.map((p, i) => (
            <li key={i} className="dsp-violation">
              <code className="dsp-name">{p.path || 'canon'}</code> <span>{p.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {!donts.length ? (
        <p className="dsp-muted">The law lists no hard don’ts to check.</p>
      ) : (
        <>
          {report.violations.length ? (
            <ul className="dsp-violations" aria-label="Violations">
              {report.violations.map((v, i) => (
                <li key={i} className="dsp-violation">
                  <code className="dsp-name">{v.unit}</code> <code className="dsp-muted">{v.element}</code>
                  <div>{v.message}</div>
                  <div className="dsp-muted">
                    {words(v.dont)} [check: {v.rule}]
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          {report.manual.length ? (
            <>
              <h3 className="dsp-subheading">To judge by hand</h3>
              <ul className="dsp-manual" aria-label="To judge by hand">
                {report.manual.map((dont) => (
                  <li key={dont.index}>{dont.text}</li>
                ))}
              </ul>
            </>
          ) : null}
          {report.unknown.length ? (
            <>
              <h3 className="dsp-subheading">Tags MAWS cannot run</h3>
              <ul className="dsp-manual" aria-label="Tags MAWS cannot run">
                {report.unknown.map((u, i) => (
                  <li key={i}>
                    <code>{u.tag}</code> {u.message}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
