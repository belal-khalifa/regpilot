// The fixed rules of the regulatory check (REG-262): exact checks with no AI guessing.
//  * Ingredients against the EU banned and restricted lists (EC 1223/2009 Annexes II to VI), matched by
//    name or CAS number, with percentages compared to the limits.
//  * Required documents and certificates against the Dubai Municipality guideline (GU116 cosmetics,
//    GU117 fragrances).
// No database or network calls here, so the logic can be tested on its own.

export type Status = 'pass' | 'issue' | 'needs_expert'
export type Area = 'claims' | 'label' | 'ingredients' | 'certificates'

export type Finding = {
  area: Area
  item: string
  status: Status
  explanation: string
  evidence: string
  changes_product_type: boolean
  clause: string
  source_title: string
  source_version: string
  source_label: string
}

export type Rule = {
  annex: string
  ref: string
  chemical_name: string
  inci_name: string
  cas_numbers: string[]
  names: string[]
  product_type: string
  max_concentration: string
  other_conditions: string
  warnings: string
}

export type Passage = { label: string; content: string; title: string; version: string }

export type Ingredient = { inci_name?: string; percentage?: string; cas_number?: string }

export type Source = { title: string; version: string }

// Must match normalise_name() in scripts/references/update_references.py, which builds rule names.
export function normaliseName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
}

// The names an ingredient line can be looked up by: the whole name, the name without a bracketed part
// ("Titanium Dioxide (CI 77891)" also as "Titanium Dioxide" and "CI 77891"), and each half of "A/B".
export function lookupNames(inci: string): string[] {
  const names = new Set<string>()
  const add = (n: string) => {
    const v = normaliseName(n)
    if (v.length >= 3) names.add(v)
  }
  add(inci)
  const bracket = inci.match(/^(.*?)\((.*?)\)\s*$/)
  if (bracket) {
    add(bracket[1])
    add(bracket[2])
  }
  for (const part of inci.split('/')) add(part)
  return [...names]
}

export function casNumbers(text: string | undefined): string[] {
  return [...new Set((text ?? '').match(/\b\d{2,7}-\d{2}-\d\b/g) ?? [])]
}

// A stated percentage as a range: "0.5" or "0,5 %" -> 0.5 to 0.5; "< 1" -> 0 to 1; "1-5" -> 1 to 5.
// Null when no number is given ("q.s.", "balance", blank).
export function parsePercentage(text: string | undefined): { low: number; high: number } | null {
  const t = (text ?? '').replace(/,(?=\d)/g, '.')
  const numbers = (t.match(/\d+(?:\.\d+)?/g) ?? []).map(Number).filter((n) => n <= 100)
  if (!numbers.length) return null
  const high = Math.max(...numbers)
  const low = /<|≤|up to|max/i.test(t) ? 0 : Math.min(...numbers)
  return { low, high }
}

// The percentage limits in an annex cell, e.g. "(a) 3,0 %\n(b) 2,0 %\n(c) 0,5 %" -> [3, 2, 0.5].
// Only "N %" figures count; ppm and other units are left to the expert.
export function parseLimits(text: string): number[] {
  return [...text.replace(/,(?=\d)/g, '.').matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((m) => Number(m[1]))
}

const ANNEX_MEANING: Record<string, string> = {
  'Annex II': 'prohibited in cosmetic products',
  'Annex III': 'allowed only within the restrictions listed',
  'Annex IV': 'an allowed colorant, within the conditions listed',
  'Annex V': 'an allowed preservative, within the conditions listed',
  'Annex VI': 'an allowed UV filter, within the conditions listed',
}

// The rule written out in full, as quoted under the finding.
export function ruleClause(rule: Rule): string {
  const parts = [
    `${rule.annex}, entry ${rule.ref}: ${rule.chemical_name.replace(/\n/g, '; ')}`,
    rule.inci_name && `Ingredient name: ${rule.inci_name.replace(/\n/g, '; ')}`,
    rule.cas_numbers.length ? `CAS: ${rule.cas_numbers.join(', ')}` : '',
    rule.product_type && `Product type: ${rule.product_type.replace(/\n/g, ' ')}`,
    rule.max_concentration && `Maximum concentration: ${rule.max_concentration.replace(/\n/g, ' ')}`,
    rule.other_conditions && `Other: ${rule.other_conditions.replace(/\n/g, ' ')}`,
    rule.warnings && `Required wording on the label: ${rule.warnings.replace(/\n/g, ' ')}`,
  ]
  return parts.filter(Boolean).join('. ')
}

// The only "other" condition that is met just by the ingredient being declared: the fragrance allergens'
// "presence ... shall be indicated in the list of ingredients" rule.
// Purity criteria of a colorant concern the raw material's specification, not the product, so they
// count the same way.
function onlyDeclarationCondition(rule: Rule): boolean {
  const other = rule.other_conditions.trim()
  return (
    other === '' ||
    /^the presence of the substance shall be indicated in the list of ingredients/i.test(other) ||
    /^purity criteria as set out in/i.test(other)
  )
}

export type RequiredWarning = { ingredient: string; wording: string; rule: string }

export function ingredientFindings(
  ingredients: Ingredient[],
  rules: Rule[],
  source: Source,
): { findings: Finding[]; warnings: RequiredWarning[] } {
  const findings: Finding[] = []
  const warnings: RequiredWarning[] = []
  const base = { area: 'ingredients' as const, changes_product_type: false, source_title: source.title, source_version: source.version }
  let checked = 0
  let withoutPercentage = 0

  for (const ingredient of ingredients) {
    const inci = (ingredient.inci_name ?? '').trim()
    if (!inci) continue
    checked += 1
    const names = new Set(lookupNames(inci))
    const cas = new Set(casNumbers(ingredient.cas_number))
    const matched = rules.filter((r) => r.names.some((n) => names.has(n)) || r.cas_numbers.some((c) => cas.has(c)))
    if (!matched.length) continue

    const pct = parsePercentage(ingredient.percentage)
    if (!pct) withoutPercentage += 1
    const evidence = `${inci}${ingredient.percentage ? ` at ${ingredient.percentage}${/%/.test(ingredient.percentage) ? '' : ' %'}` : ', percentage not given'}${ingredient.cas_number ? ` (CAS ${ingredient.cas_number})` : ''}`

    // Banned substances outrank everything else.
    const banned = matched.filter((r) => r.annex === 'Annex II')
    if (banned.length) {
      const rule = banned[0]
      findings.push({
        ...base,
        item: inci,
        status: 'issue',
        explanation: `${inci} matches a substance ${ANNEX_MEANING['Annex II']} (EU Annex II, entry ${rule.ref}).`,
        evidence,
        clause: ruleClause(rule),
        source_label: `Annex II, entry ${rule.ref}`,
      })
      continue
    }

    // One finding per ingredient, over every entry it falls under: a substance can be a preservative
    // in Annex V and, for other uses, restricted in Annex III, so it is over the limit only if it is
    // over every limit that could apply.
    const entryLabels = [...new Set(matched.map((r) => `${r.annex}, entry ${r.ref}`))]
    const label = entryLabels.join('; ')
    const clause = matched.map(ruleClause).filter((c, i, all) => all.indexOf(c) === i).join('\n')
    const limits = matched.flatMap((r) => parseLimits(r.max_concentration))
    const hasProductType = matched.some((r) => r.product_type.trim())
    const conditionsOnly = matched.every(onlyDeclarationCondition)
    for (const r of matched) {
      const wording = r.warnings.replace(/\(\d+\)/g, '').replace(/\s+/g, ' ').trim()
      if (wording && !warnings.some((w) => w.ingredient === inci && w.wording === wording)) {
        warnings.push({ ingredient: inci, wording, rule: `${r.annex}, entry ${r.ref}` })
      }
    }

    let status: Status
    let explanation: string
    if (limits.length && pct) {
      const lowest = Math.min(...limits)
      const highest = Math.max(...limits)
      if (pct.low > highest) {
        status = 'issue'
        explanation = `${inci} is above ${highest} %, the highest limit that could apply (${label}).`
      } else if (pct.high <= lowest && !hasProductType && conditionsOnly) {
        status = 'pass'
        explanation = `${inci} is within the ${lowest} % limit (${label}).`
      } else if (pct.high <= lowest) {
        status = 'needs_expert'
        explanation = `${inci} is within the lowest limit (${lowest} %), but ${label} also sets conditions on product type or use that need an expert's eye.`
      } else {
        status = 'needs_expert'
        explanation = `${inci} is within some but not all of the limits (${[...new Set(limits)].join(' %, ')} %) in ${label}; which one applies depends on the product type or use.`
      }
    } else if (limits.length) {
      status = 'needs_expert'
      explanation = `${label} limits ${inci} to ${[...new Set(limits)].join(' % or ')} %, but the documents do not give its percentage.`
    } else if (!hasProductType && conditionsOnly) {
      status = 'pass'
      explanation = `${inci} is ${ANNEX_MEANING[matched[0].annex] ?? 'listed'} (${label}).${matched.some((r) => /indicated in the list of ingredients/i.test(r.other_conditions)) ? ' It must be named in the ingredient list on the label.' : ''}`
    } else {
      status = 'needs_expert'
      explanation = `${inci} falls under ${label}, which sets conditions that need an expert's eye.`
    }
    findings.push({ ...base, item: inci, status, explanation, evidence, clause, source_label: label })
  }

  // One line that says the whole list was checked, so a clean list is visible too.
  if (checked) {
    const flagged = new Set(findings.filter((f) => f.status !== 'pass').map((f) => f.item)).size
    findings.unshift({
      ...base,
      item: 'Ingredient list against the EU banned and restricted lists',
      status: flagged ? 'needs_expert' : 'pass',
      explanation: `${checked} ingredients checked by name${ingredients.some((i) => i.cas_number) ? ' and CAS number' : ''}; ${flagged ? `${flagged} need a closer look (below)` : 'none is banned or over a limit'}.${withoutPercentage ? ` ${withoutPercentage} restricted ingredient${withoutPercentage === 1 ? ' has' : 's have'} no percentage in the documents.` : ''}`,
      evidence: '',
      clause: 'Annexes II to VI of Regulation (EC) No 1223/2009 list the substances that are prohibited (II) or allowed only within limits (III), and the allowed colorants (IV), preservatives (V) and UV filters (VI).',
      source_label: 'Annexes II to VI',
    })
  } else {
    findings.push({
      ...base,
      item: 'Ingredient list',
      status: 'issue',
      explanation: 'No ingredient list was found in the documents, so the ingredients could not be checked.',
      evidence: '',
      clause: '',
      source_label: '',
    })
  }
  return { findings, warnings }
}

// ------------------------------------------------------------------ documents and certificates

export type CertificateSeen = {
  file_name: string
  kind: 'free_sale' | 'gmp' | 'halal' | 'other'
  names_product: 'yes' | 'no' | 'unclear'
  valid_until: string
}

export type DocumentFacts = {
  guideline: 'GU116' | 'GU117'
  madeInUae: boolean | null // null: country of origin unknown
  country: string
  hasFormula: boolean
  hasFreeSale: boolean
  hasGmp: boolean
  certificateNamesProduct: 'yes' | 'no' | 'not_applicable' | 'no_certificate' | undefined
  certificates: CertificateSeen[] // what the AI read saw on the certificates themselves
  halalLogo: boolean
  today: string // YYYY-MM-DD
}

// Where each document rule sits in the two guidelines.
const SECTIONS = {
  GU116: { freeSale: 'Section 9.1', ingredients: 'Section 9.2', gmp: 'Section 9.3', other: 'Section 9.5' },
  GU117: { freeSale: 'Section 7.4', ingredients: 'Section 7.2', gmp: 'Section 7.3', other: '' },
}

export function findPassage(passages: Passage[], prefix: string): Passage | undefined {
  return passages.find((p) => p.label === prefix || p.label.startsWith(`${prefix} `))
}

export function documentFindings(facts: DocumentFacts, passages: Passage[]): Finding[] {
  const s = SECTIONS[facts.guideline]
  const cite = (section: string) => {
    const p = section ? findPassage(passages, `${facts.guideline}, ${section}`) : undefined
    return p
      ? { clause: p.content, source_title: p.title, source_version: p.version, source_label: p.label }
      : { clause: '', source_title: '', source_version: '', source_label: '' }
  }
  const finding = (item: string, status: Status, explanation: string, section: string, evidence = ''): Finding => {
    const c = cite(section)
    // A rule we cannot quote is not a rule we can apply: the expert decides.
    return { area: 'certificates', item, status: c.clause ? status : 'needs_expert', explanation, evidence, changes_product_type: false, ...c }
  }
  const findings: Finding[] = []

  findings.push(
    facts.hasFormula
      ? finding('Ingredient report', 'pass', 'A formula or ingredient report is among the documents.', s.ingredients)
      : finding('Ingredient report', 'issue', 'No formula or ingredient report was found. The guideline asks for the full ingredient report from the manufacturer.', s.ingredients),
  )

  const validity = (kind: CertificateSeen['kind'], name: string, section: string) => {
    const seen = facts.certificates.filter((c) => c.kind === kind)
    const dates = seen.map((c) => c.valid_until).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()
    if (!dates.length) {
      findings.push(finding(`${name}: validity`, 'needs_expert', `No expiry or validity date could be read on the ${name}. It must be valid when you submit.`, section))
    } else if (dates[dates.length - 1] < facts.today) {
      findings.push(finding(`${name}: validity`, 'issue', `The ${name} expired on ${dates[dates.length - 1]}. It must be valid when you submit.`, section, `Valid until ${dates[dates.length - 1]}`))
    } else {
      findings.push(finding(`${name}: validity`, 'pass', `The ${name} is valid until ${dates[dates.length - 1]}.`, section, `Valid until ${dates[dates.length - 1]}`))
    }
  }

  if (facts.madeInUae === null) {
    findings.push(finding('Free Sale or GMP certificate', 'needs_expert', 'The country of origin could not be read, so it is not clear whether a Free Sale Certificate (imported products) or a GMP certificate (UAE-made products) is needed.', s.freeSale))
  } else if (facts.madeInUae) {
    if (!facts.hasGmp) {
      findings.push(finding('GMP certificate (ISO 22716)', 'issue', 'The product is made in the UAE, so a GMP (ISO 22716) certificate of the factory is needed, and none was found.', s.gmp))
    } else {
      findings.push(finding('GMP certificate (ISO 22716)', 'pass', 'The product is made in the UAE and a GMP certificate is among the documents.', s.gmp))
      validity('gmp', 'GMP certificate', s.gmp)
    }
  } else {
    if (!facts.hasFreeSale) {
      findings.push(finding('Free Sale Certificate', 'issue', `The product is made in ${facts.country || 'another country'}, so a Free Sale Certificate from the country of origin is needed, and none was found.`, s.freeSale))
    } else {
      if (facts.certificateNamesProduct === 'no') {
        findings.push(finding('Free Sale Certificate', 'issue', 'The Free Sale Certificate does not name this product. If the name sold in Dubai differs, a confirmation letter from the product owner, attested in the country of origin, is needed.', s.freeSale))
      } else if (facts.certificateNamesProduct === 'yes') {
        findings.push(finding('Free Sale Certificate', 'pass', 'A Free Sale Certificate is among the documents and names this product.', s.freeSale))
      } else {
        findings.push(finding('Free Sale Certificate', 'needs_expert', 'A Free Sale Certificate is among the documents, but it is not clear whether it names this product.', s.freeSale))
      }
      validity('free_sale', 'Free Sale Certificate', s.freeSale)
    }
  }

  if (facts.halalLogo) {
    const halal = facts.certificates.some((c) => c.kind === 'halal')
    findings.push(
      halal
        ? finding('Halal certificate', 'pass', 'The label shows a Halal logo and a Halal certificate is among the documents.', s.other)
        : finding('Halal certificate', 'issue', 'The label shows a Halal logo, so a valid Halal certificate from a recognised Islamic society is needed, and none was found.', s.other),
    )
  }
  return findings
}

// ------------------------------------------------------------------ AI findings

// A quote counts only if it really is in the passage (spacing and quote marks aside).
export function quoteIsInPassage(quote: string, passage: string): boolean {
  const norm = (t: string) => t.toLowerCase().replace(/[‘’“”"'`]/g, '').replace(/[^a-z0-9؀-ۿ%.]+/g, ' ').trim()
  const q = norm(quote)
  return q.length >= 12 && norm(passage).includes(q)
}

export type AiFinding = {
  item: string
  status: string
  observed?: string
  explanation?: string
  source?: string
  quote?: string
  changes_product_type?: boolean
}

// Turns an AI finding into a stored one. Without a real quote from a numbered passage, Pass or Issue
// becomes Needs expert: the AI may not guess.
export function checkedAiFinding(area: Area, f: AiFinding, passages: Passage[]): Finding {
  const index = Number(String(f.source ?? '').replace(/\D/g, '')) - 1
  const passage = index >= 0 ? passages[index] : undefined
  const quoted = !!passage && !!f.quote && quoteIsInPassage(f.quote, passage.content)
  let status: Status = f.status === 'pass' || f.status === 'issue' ? f.status : 'needs_expert'
  let explanation = (f.explanation ?? '').trim()
  if (!quoted && status !== 'needs_expert') {
    status = 'needs_expert'
    explanation = `${explanation}${explanation ? ' ' : ''}(No rule could be quoted for this point, so an expert will decide.)`
  }
  // A claim that may take the product out of cosmetics is never cleared by the AI alone.
  if (f.changes_product_type && status === 'pass') status = 'needs_expert'
  return {
    area,
    item: (f.item ?? '').trim().slice(0, 300) || 'Unnamed point',
    status,
    explanation: explanation.slice(0, 1200),
    evidence: (f.observed ?? '').trim().slice(0, 600),
    changes_product_type: !!f.changes_product_type,
    clause: quoted ? f.quote!.trim() : '',
    source_title: quoted ? passage!.title : '',
    source_version: quoted ? passage!.version : '',
    source_label: quoted ? passage!.label : '',
  }
}
