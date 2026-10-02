import { join } from 'node:path';

const shellLiteral = (text: string): string => `'${text.replaceAll("'", "'\\''")}'`;

// Literal path segments stay literal; only the hook's parent PID is shell-expanded.
export function hookStartedCommand(root: string): string {
  return `touch ${shellLiteral(join(root, 'hooks', 'started-'))}"$PPID"`;
}

export function terminalPwdCommand(file: string): string {
  return `pwd > ${shellLiteral(file)}\n`;
}
