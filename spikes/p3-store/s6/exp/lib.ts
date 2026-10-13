// A tiny check harness: every experiment records named checks and numbers, prints them and writes out/<name>.{txt,json}.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'out')

export class Report {
  private lines: string[] = []
  private checks: { name: string; pass: boolean; detail?: unknown }[] = []
  private numbers: Record<string, unknown> = {}
  private name: string
  constructor(name: string) { this.name = name }
  log(...a: unknown[]): void { const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); this.lines.push(s); console.log(s) }
  check(name: string, pass: boolean, detail?: unknown): boolean {
    this.checks.push({ name, pass, detail })
    this.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  ' + JSON.stringify(detail)}`)
    return pass
  }
  num(name: string, v: unknown): void { this.numbers[name] = v; this.log(`NUM   ${name} = ${JSON.stringify(v)}`) }
  write(): void {
    mkdirSync(OUT, { recursive: true })
    const failed = this.checks.filter((c) => !c.pass).length
    this.log(`\n${this.checks.length - failed}/${this.checks.length} checks passed`)
    writeFileSync(join(OUT, `${this.name}.txt`), this.lines.join('\n') + '\n')
    writeFileSync(join(OUT, `${this.name}.json`), JSON.stringify({ checks: this.checks, numbers: this.numbers }, null, 2) + '\n')
    if (failed) process.exitCode = 1
  }
}
