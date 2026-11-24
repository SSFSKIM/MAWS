// D14 §6, the check: the canon's structure (D6's `validateCanon`, with the page's parser; a host without one stores
// canon unchecked, Decision Log 26) and the law's tagged hard don'ts run over the system's own canon (M2's
// `checkHardDonts`), listing each file problem and each violation where it is, the rules that passed, the don'ts left
// to judgment, and the tags MAWS cannot run.
// The word cut (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M5 task 4): a canon that keeps every rule reads a
// muted ✓ and the count, the sentence its name and tooltip (G584); a violation ends with the law's words, its tag their
// tooltip and description (G585); the don'ts no rule checks and those whose tag MAWS cannot run are one list, "By hand",
// by their words (G586, G587). A description node stands outside the text it describes.
import { useId, type Ref } from 'react';
import { BareCount } from '../../../renderer/src/ui/count';
import { Tip } from '../../../renderer/src/ui/tip';
import { canonUnits, validateCanon, type CanonProblem, type HtmlParser } from '../canon';
import { checkHardDonts } from '../check';
import { parseLaw } from '../law';
import type { TokenSet } from '../tokens';
import { PAGE_COPY } from './copy';

export function checkCanon(law: string, tokens: TokenSet, files: Readonly<Record<string, string>>, parser: HtmlParser) {
  const parsed = parseLaw(law);
  return { donts: parsed.donts, report: checkHardDonts(parsed, tokens, canonUnits(files, parser)), problems: validateCanon(files, parser, tokens) };
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One line for the check: the canon's file problems and the rules' violations; null when there are none (a canon that
 * keeps every checked rule reads its ✓ and count instead, and one with no rule to check reads neither). */
function failuresOf(problems: readonly CanonProblem[], report: ReturnType<typeof checkHardDonts>): string | null {
  const broken = report.checks.filter((c) => c.violations).length;
  const parts = [
    ...(problems.length ? [`${count(problems.length, 'file problem', 'file problems')} in the canon`] : []),
    ...(report.violations.length ? [`${count(report.violations.length, 'violation', 'violations')} of ${count(broken, 'checked rule', 'checked rules')}`] : []),
  ];
  return parts.length ? `${parts.join('; ')}.` : null;
}

/** The don'ts to judge by hand, in the law's order: those no rule checks and those with a tag MAWS cannot run. */
function byHandOf(donts: readonly { index: number; text: string }[], report: ReturnType<typeof checkHardDonts>) {
  const listed = new Set([...report.manual.map((dont) => dont.index), ...report.unknown.map((u) => u.dont)]);
  return donts.filter((dont) => listed.has(dont.index));
}

export function Check(props: { law: string; tokens: TokenSet; files: Readonly<Record<string, string>>; parser: HtmlParser; sectionRef?: Ref<HTMLElement> }) {
  const { donts, report, problems } = checkCanon(props.law, props.tokens, props.files, props.parser);
  const failures = failuresOf(problems, report);
  const words = (index: number) => donts.find((dont) => dont.index === index)?.text ?? '';
  const byHand = byHandOf(donts, report);
  const tagId = useId();
  return (
    <section ref={props.sectionRef} className="dsp-section" data-ds-section="check" aria-labelledby="dsp-check" tabIndex={-1}>
      <h2 id="dsp-check" className="dsp-heading">
        Check against law
      </h2>
      {failures !== null ? (
        <p className="dsp-summary">{failures}</p>
      ) : report.checks.length > 0 ? (
        <p className="dsp-summary">
          <BareCount count={PAGE_COPY.passed(report.checks.length)} meaning={PAGE_COPY.passedName(report.checks.length)} />
        </p>
      ) : null}
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
            <>
              <ul className="dsp-violations" aria-label="Violations">
                {report.violations.map((v, i) => (
                  <li key={i} className="dsp-violation">
                    <code className="dsp-name">{v.unit}</code> <code className="dsp-muted">{v.element}</code>
                    <div>{v.message}</div>
                    <div className="dsp-muted">
                      <Tip content={PAGE_COPY.checkTagTip(v.rule)}>
                        <span className="dsp-dont-words" tabIndex={0} aria-describedby={`${tagId}-${i}`} data-dont-words>
                          {words(v.dont)}
                        </span>
                      </Tip>
                    </div>
                  </li>
                ))}
              </ul>
              <div hidden>
                {report.violations.map((v, i) => (
                  <span key={i} id={`${tagId}-${i}`}>
                    {PAGE_COPY.checkTagTip(v.rule)}
                  </span>
                ))}
              </div>
            </>
          ) : null}
          {byHand.length ? (
            <>
              <h3 className="dsp-subheading">{PAGE_COPY.byHand}</h3>
              <ul className="dsp-manual" aria-label={PAGE_COPY.byHand}>
                {byHand.map((dont) => (
                  <li key={dont.index}>{dont.text}</li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
