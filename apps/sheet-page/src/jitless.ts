// Zod compiles a fast path for an object schema with `new Function` where it may, and finds out whether it may by
// trying once, which the page's content policy (no `eval`, §M) refuses and the browser reports as a violation. The page
// parses every answer of mawsd with the shared schemas, so it tells zod not to try. Imported first by main.tsx.
import { z } from 'zod';

z.config({ jitless: true });
