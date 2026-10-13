// S1 scenario 5 shared sample: the markdown both Node writers round-trip. Throwaway spike code (P3-0, S1).
export const sample = `# Plan

Intro paragraph with **bold**, *italic*, \`code\` and a [link](https://example.com).

## Risks

- first item
- second item with **bold**

1. one
2. two

> a quote

\`\`\`ts
const x = 1
\`\`\`

| Name | Value |
| --- | --- |
| alpha | 1 |
| beta | 2 |

---

Closing paragraph. It has two sentences.
`
