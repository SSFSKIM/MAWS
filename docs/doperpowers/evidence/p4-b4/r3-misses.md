# R-3: the labelled set’s misses (P4-B4 M5)

R-3 (P4-B4 M5): test/fixtures/search/r3-labelled-set.json through the shipped artifact_search (scope all, limit 10) over a real store seeded by test/artifacts/r3-labelled-set.test.ts. found: an expected artifact among the ten hits; rank: the first right answer’s place; designed: the literal oracle’s verdict (every word of the query in an expected artifact’s title or text), asserted only when found. Regenerate with `MAWS_R3_WRITE=1 pnpm exec vitest run --project node test/artifacts/r3-labelled-set.test.ts`.

21 of 40 queries found. Designed to be found: 21, found 21, at rank 1 21. Designed misses: 19, found anyway 0.

| Class | Queries | Found | Missed | Designed misses |
|---|---|---|---|---|
| title | 5 | 5 | 0 | 0 |
| body | 6 | 6 | 0 | 0 |
| particle | 4 | 1 | 3 | 3 |
| short-term | 3 | 3 | 0 | 0 |
| phrase | 4 | 4 | 0 | 0 |
| cross-language | 9 | 0 | 9 | 9 |
| concept | 6 | 0 | 6 | 6 |
| mixed | 3 | 2 | 1 | 1 |

| Query | Class | Expected | Found | Rank |
|---|---|---|---|---|
| Console | title | console-check | yes | 1 |
| Notion route check | title | route-check | yes | 1 |
| GOV.UK sample | title | govuk | yes | 1 |
| P3 sitting deck | title | deck | yes | 1 |
| Additional observations | title | obs | yes | 1 |
| Japanese price | body | note | yes | 1 |
| tasks.csv | body | dash | yes | 1 |
| Note taker | body | dash | yes | 1 |
| 접근성 트리 | body | obs | yes | 1 |
| 마감일 전에 알려 | body | design | yes | 1 |
| Space precedence | body | untitled-space | yes | 1 |
| 코멘트 | particle | obs | yes | 1 |
| 슬라이드를 편집 | particle | obs | no | – |
| 더블클릭 | particle | obs | no | – |
| 채팅을 축소 | particle | obs | no | – |
| 일정 | short-term | design | yes | 1 |
| P3 DS | short-term | ds-p3 | yes | 1 |
| 문서 옆 | short-term | obs | yes | 1 |
| "Tell the Space owner first" | phrase | deck | yes | 1 |
| "Next steps and owners" | phrase | deck | yes | 1 |
| "accent appears once" | phrase | ds-p3, maws-ds | yes | 1 |
| "follow-up sitting" | phrase | note | yes | 1 |
| 참석자 슬라이드 | cross-language | deck | no | – |
| 리스크 | cross-language | note | no | – |
| 예산 승인 | cross-language | launch | no | – |
| 발표자 노트 | cross-language | deck | no | – |
| 정부 디자인 시스템 | cross-language | govuk | no | – |
| Google Docs comments | cross-language | obs | no | – |
| accessibility tree | cross-language | obs | no | – |
| double click | cross-language | obs | no | – |
| deadline reminder | cross-language | design | no | – |
| concurrent editing test | concept | note, deck, design | no | – |
| mobile layout | concept | design | no | – |
| workload per person | concept | dash | no | – |
| release date moved | concept | launch | no | – |
| stale data | concept | dash | no | – |
| cross-origin iframe | concept | oopif | no | – |
| Artifact Search 툴 | mixed | obs | yes | 1 |
| settings.json 건드리지 | mixed | catalogue | yes | 1 |
| Canva 슬라이드 편집 | mixed | obs | no | – |
