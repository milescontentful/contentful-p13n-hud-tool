// Selftest for the rule evaluator (src/evaluate.ts). Zero dependencies:
//
//   node test/evaluate.selftest.ts          # green run: every case must pass
//
// It then MUTATES the evaluator (plants known bugs — e.g. "treat missing data
// as not matched") and re-runs the same cases against each mutant. Every
// mutant must go RED. A test that has never been seen failing is not a test.
//
// Fixtures are REAL nt_audience entries (CMA read, 2026-09-29):
//   test/fixtures/demo-2.1-svs1g2yaeyzo.json  — 02 - Demo 2.1: track-event OR URL-contains, All Visitors, UTM "campaign"
//   test/fixtures/meridian-2p5diqrd23ie.json  — 0 - Meridian Outfitters: the 3 UTM campaign audiences
// plus shapes observed in a real export (identify = trait, location) and the
// page-count rule from the README.
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const load = (f: string) => JSON.parse(readFileSync(join(here, 'fixtures', f), 'utf8')).items as unknown[]

type Ev = typeof import('../src/evaluate.ts')

// hand-built rule shapes (copied from real exports / README)
const EXTRA = [
  {
    sysId: 'x-loyal',
    fields: {
      nt_audience_id: { 'en-US': 'x-loyal' },
      nt_name: { 'en-US': 'Loyal (3+ page views)' },
      nt_rules: { 'en-US': { any: [{ all: [{ type: 'page', count: '3', key: '', value: '', operator: 'greaterThanInclusive', conditions: [{ key: { id: 'context_page_url', label: 'URL' }, operator: 'equal', value: '*' }] }] }] } },
    },
  },
  {
    sysId: 'x-trait',
    fields: {
      nt_audience_id: { 'en-US': 'x-trait' },
      nt_name: { 'en-US': 'Business users (trait)' },
      nt_rules: { 'en-US': { any: [{ all: [{ key: 'customer-category', type: 'identify', count: '1', value: 'business-user', operator: 'equal', conditions: [] }] }] } },
    },
  },
  {
    sysId: 'x-city',
    fields: {
      nt_audience_id: { 'en-US': 'x-city' },
      nt_name: { 'en-US': 'Heidelberg (location)' },
      nt_rules: { 'en-US': { any: [{ all: [{ key: 'city', type: 'location', count: '1', value: 'Heidelberg', operator: 'equal', conditions: [] }] }] } },
    },
  },
  {
    sysId: 'x-numcount',
    fields: {
      nt_audience_id: { 'en-US': 'x-numcount' },
      nt_name: { 'en-US': 'Broken format (count as number)' },
      nt_rules: { 'en-US': { any: [{ all: [{ type: 'page', count: 1, key: null, value: null, operator: 'greaterThanInclusive', conditions: [{ key: { id: 'context_campaign_name' }, operator: 'equal', value: 'climb' }] }] }] } },
    },
  },
]

const home = (campaign?: string) => ({ url: 'https://meridian.colorfuldemo.com/', campaign: campaign ? { name: campaign } : undefined })

function runCases(ev: Ev): string[] {
  const all = ev.audiencesFromEntries([...load('demo-2.1-svs1g2yaeyzo.json'), ...load('meridian-2p5diqrd23ie.json'), ...EXTRA])
  const by = (id: string) => {
    const a = all.find((x) => x.id === id || x.name === id)
    if (!a) throw new Error(`fixture missing: ${id}`)
    return a
  }
  const fails: string[] = []
  const check = (label: string, got: unknown, want: unknown) => {
    if (got !== want) fails.push(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
  }
  const outcome = (id: string, f: Parameters<Ev['evaluateAudience']>[1]) => ev.evaluateAudience(by(id), f)

  check('fixtures loaded', all.length, 10)

  // --- Meridian UTM rules --------------------------------------------------
  const climb = 'p13n-aud-utm-climb'
  check('climb · plain link → NO DATA', outcome(climb, { pages: [home()] }).outcome, 'no-data')
  check('climb · plain link says why', outcome(climb, { pages: [home()] }).conditions?.[0].observed, 'no campaign name on this visit')
  check('climb · climb link → matched', outcome(climb, { pages: [home('climb')] }).outcome, 'matched')
  check('climb · plain-English text', outcome(climb, { pages: [home('climb')] }).conditions?.[0].text, 'Campaign name equals "climb"')
  check('climb · live value', outcome(climb, { pages: [home('climb')] }).conditions?.[0].observed, 'climb')
  check('climb · family link → not matched', outcome(climb, { pages: [home('family')] }).outcome, 'not-matched')
  check('family · family link → matched', outcome('p13n-aud-utm-family', { pages: [home('family')] }).outcome, 'matched')
  check('members · MEMBERS (case) → matched', outcome('p13n-aud-utm-members', { pages: [home('MEMBERS')] }).outcome, 'matched')
  check('climb · earlier climb page + plain page → matched', outcome(climb, { pages: [home('climb'), home()] }).outcome, 'matched')
  check('climb · pages not measured → NO DATA', outcome(climb, {}).outcome, 'no-data')

  // --- Demo 2.1: Highly Engaged = event contact_sales_clicked ≥1 OR URL contains "pricing"
  const hot = 'Highly Engaged'
  check('engaged · home, no events → NO DATA (event unknown)', outcome(hot, { pages: [home()], events: [] }).outcome, 'no-data')
  check('engaged · event row says no events yet', outcome(hot, { pages: [home()], events: [] }).conditions?.[0].observed, 'no events yet')
  check('engaged · event text', outcome(hot, { pages: [home()] }).conditions?.[0].text, 'Event contact_sales_clicked ≥ 1')
  check('engaged · URL row text', outcome(hot, { pages: [home()] }).conditions?.[1].text, 'Page URL contains "pricing"')
  check('engaged · clicked contact sales → matched', outcome(hot, { pages: [home()], events: [{ name: 'contact_sales_clicked' }] }).outcome, 'matched')
  check('engaged · other event only, home → not matched', outcome(hot, { pages: [home()], events: [{ name: 'newsletter' }] }).outcome, 'not-matched')
  check('engaged · visited /pricing → matched', outcome(hot, { pages: [{ url: 'https://x.test/pricing' }] }).outcome, 'matched')
  check('all visitors · one page → matched', outcome('All Visitors', { pages: [home()] }).outcome, 'matched')
  check('campaign · utm_campaign=campaign → matched', outcome('Campaign', { pages: [home('campaign')] }).outcome, 'matched')

  // --- page count ------------------------------------------------------------
  check('loyal · 1 view → not matched', outcome('x-loyal', { pages: [home()] }).outcome, 'not-matched')
  check('loyal · text', outcome('x-loyal', { pages: [home()] }).conditions?.[0].text, 'Viewed any page ≥ 3 times')
  check('loyal · live value', outcome('x-loyal', { pages: [home()] }).conditions?.[0].observed, '1')
  check('loyal · 3 views → matched', outcome('x-loyal', { pages: [home(), home(), home()] }).outcome, 'matched')

  // --- traits ------------------------------------------------------------------
  check('trait · not set → NO DATA', outcome('x-trait', { traits: {} }).outcome, 'no-data')
  check('trait · matching → matched', outcome('x-trait', { traits: { 'customer-category': 'business-user' } }).outcome, 'matched')
  check('trait · other value → not matched', outcome('x-trait', { traits: { 'customer-category': 'consumer' } }).outcome, 'not-matched')

  // --- honest limits: never a guess ---------------------------------------------
  const city = outcome('x-city', { pages: [home()], traits: {} })
  check('location · cannot evaluate → NO DATA', city.outcome, 'no-data')
  check('location · says so', city.conditions?.[0].observed, "can't evaluate here (rule type location)")
  check('location · flagged unsupported', city.conditions?.[0].unsupported, true)
  check('count-as-number · flagged, not guessed', outcome('x-numcount', { pages: [home('climb')] }).conditions?.[0].unsupported, true)

  // --- Experience API confirmation is shown, not silently merged -------------
  check('api-confirmed shows in detail', outcome(climb, { pages: [home('climb')], confirmedAudiences: [climb] }).detail.includes('Experience API: joined'), true)
  return fails
}

// ---- mutants: each plants one bug the cases above must catch ----------------
const MUTANTS: { name: string; from: string; to: string }[] = [
  { name: 'missing page value treated as NOT matched', from: 'if (state) state = null // MISSING is not a failure', to: 'state = false; break' },
  { name: 'no events treated as NOT matched', from: "observed: 'no events yet', outcome: 'no-data'", to: "observed: 'no events yet', outcome: 'not-matched'" },
  { name: 'missing trait treated as NOT matched', from: "observed: 'not set', outcome: 'no-data'", to: "observed: 'not set', outcome: 'not-matched'" },
  { name: 'unsupported rule guessed as not matched', from: "outcome: 'no-data', unsupported: true", to: "outcome: 'not-matched', unsupported: true" },
  { name: 'OR lets NO DATA beat a match', from: "if (xs.includes('matched')) return 'matched'\n  if (xs.includes('no-data')) return 'no-data'", to: "if (xs.includes('no-data')) return 'no-data'\n  if (xs.includes('matched')) return 'matched'" },
  { name: 'contains compared as equals', from: 'return a.includes(w)', to: 'return a === w' },
]

const srcPath = join(here, '..', 'src', 'evaluate.ts')
const src = readFileSync(srcPath, 'utf8')

const green = runCases(await import(pathToFileURL(srcPath).href))
if (green.length) {
  console.error(`RED — the real evaluator fails ${green.length} case(s):\n  ` + green.join('\n  '))
  process.exit(1)
}
console.log('GREEN — real evaluator passes every case')

let escaped = 0
for (const [i, m] of MUTANTS.entries()) {
  if (!src.includes(m.from)) {
    console.error(`mutant "${m.name}": anchor text not found in src/evaluate.ts — update the selftest`)
    process.exit(1)
  }
  const file = join(here, `.mutant-${i}.ts`)
  writeFileSync(file, src.replace(m.from, m.to))
  try {
    const fails = runCases(await import(pathToFileURL(file).href))
    if (fails.length) console.log(`RED as required — mutant "${m.name}" caught by ${fails.length} case(s), e.g. ${fails[0]}`)
    else {
      escaped++
      console.error(`ESCAPED — mutant "${m.name}" passed every case; the selftest cannot see this bug`)
    }
  } finally {
    rmSync(file, { force: true })
  }
}
if (escaped) process.exit(1)
console.log(`OK — ${MUTANTS.length}/${MUTANTS.length} planted bugs caught`)
