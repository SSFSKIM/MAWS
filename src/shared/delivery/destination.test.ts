// P4-B5: the owner's pasted Notion page or Drive folder, read into the id a delivery request carries (./destination.ts):
// links of the service's own hosts and bare ids, nothing else.
import { describe, expect, it } from 'vitest';
import { destinationIdOf, driveFolderId, notionPageId } from './destination';

const ID = '0123456789abcdef0123456789abcdef';

describe('a delivery’s destination', () => {
  it('reads a Notion page id from its link, dashed or not, or alone', () => {
    expect(notionPageId(`https://www.notion.so/acme/Quarterly-memo-${ID}`)).toBe(ID);
    expect(notionPageId(`https://www.notion.so/${ID}?pvs=4`)).toBe(ID);
    expect(notionPageId(`https://acme.notion.site/Memo-${ID}`)).toBe(ID);
    expect(notionPageId('01234567-89ab-cdef-0123-456789ABCDEF')).toBe(ID);
    expect(notionPageId(` ${ID.toUpperCase()} `)).toBe(ID);
  });

  it('refuses anything but a Notion page', () => {
    expect(notionPageId(`https://evil.example/${ID}`)).toBeNull();
    expect(notionPageId(`http://www.notion.so/${ID}`)).toBeNull();
    expect(notionPageId('https://www.notion.so/acme/Memo')).toBeNull();
    expect(notionPageId('not a link')).toBeNull();
  });

  it('reads a Drive folder id from its link or alone, and refuses others', () => {
    expect(driveFolderId('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp?usp=sharing')).toBe('1AbCdEfGhIjKlMnOp');
    expect(driveFolderId('https://drive.google.com/drive/u/1/folders/1AbCdEfGhIjKlMnOp')).toBe('1AbCdEfGhIjKlMnOp');
    expect(driveFolderId('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp')).toBe('1AbCdEfGhIjKlMnOp');
    expect(driveFolderId('1AbCdEfGhIjKlMnOp')).toBe('1AbCdEfGhIjKlMnOp');
    expect(driveFolderId('https://docs.google.com/drive/folders/1AbCdEfGhIjKlMnOp')).toBeNull();
    expect(driveFolderId('short')).toBeNull();
    expect(driveFolderId('../../etc')).toBeNull();
  });

  it('reads by target', () => {
    expect(destinationIdOf('notion', ID)).toBe(ID);
    expect(destinationIdOf('drive', ID)).toBe(ID);
    expect(destinationIdOf('drive', 'https://www.notion.so/x')).toBeNull();
  });
});
