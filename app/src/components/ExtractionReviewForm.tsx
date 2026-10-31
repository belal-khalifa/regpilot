import { useState } from 'react'
import type { ExtractedProductData, ExtractedIngredient, ExtractedVariant } from '../lib/types'
import {
  MONTAJI_GROUPS,
  SHELF_LIFE_PERIOD_TYPES,
  VOLUME_UNITS,
  categoriesForGroup,
  documentWarnings,
  montajiReadinessIssues,
  subCategoriesFor,
} from '../lib/montajiFields'

type IngredientRow = ExtractedIngredient & { _key: string }
type VariantRow = ExtractedVariant & { _key: string }
type Confidence = NonNullable<ExtractedProductData['classification_confidence']>

const boolToChoice = (b: boolean | undefined) => (b === true ? 'yes' : b === false ? 'no' : '')
const choiceToBool = (c: string) => (c === 'yes' ? true : c === 'no' ? false : undefined)
const isUae = (country: string) => /^(uae|u\.a\.e\.?|united arab emirates)$/i.test(country.trim())

function toVariantRows(variants: ExtractedVariant[] | undefined): VariantRow[] {
  const rows = (variants ?? []).map((v) => ({ ...v, _key: newKey() }))
  return rows.length ? rows : [{ _key: newKey(), color_shade: 'NA', scent_flavor: 'NA' }]
}

function newKey() {
  return Math.random().toString(36).slice(2)
}

function toRows(ingredients: ExtractedIngredient[] | undefined): IngredientRow[] {
  return (ingredients ?? []).map((i) => ({ ...i, _key: newKey() }))
}

const inputBase =
  'rounded-full border border-hairline bg-canvas px-5 py-3 font-text text-[15px] text-ink outline-none focus:border-primary'
const inputClass = `w-full ${inputBase}`
const textareaClass =
  'w-full rounded-lg border border-hairline bg-canvas px-5 py-3 font-text text-[15px] text-ink outline-none focus:border-primary'
const labelClass = 'font-text text-[12px] font-semibold text-ink-muted-48'

export default function ExtractionReviewForm({
  initialData,
  onSave,
}: {
  initialData: ExtractedProductData
  onSave: (
    data: ExtractedProductData,
    options: { markReady: boolean },
  ) => Promise<{ error: string | null }>
}) {
  const [productName, setProductName] = useState(initialData.product_name ?? '')
  const [productType, setProductType] = useState(initialData.product_type ?? '')
  const [manufacturerName, setManufacturerName] = useState(initialData.manufacturer_name ?? '')
  const [manufacturerCountry, setManufacturerCountry] = useState(
    initialData.manufacturer_country ?? '',
  )
  const [manufacturerAddress, setManufacturerAddress] = useState(
    initialData.manufacturer_address ?? '',
  )
  const [certificateNumber, setCertificateNumber] = useState(initialData.certificate_number ?? '')
  const [certificateCountry, setCertificateCountry] = useState(
    initialData.certificate_issuing_country ?? '',
  )
  const [labelClaims, setLabelClaims] = useState((initialData.label_claims ?? []).join(', '))
  const [notes, setNotes] = useState(initialData.notes ?? '')
  const [ingredients, setIngredients] = useState<IngredientRow[]>(toRows(initialData.ingredients))
  const [brandName, setBrandName] = useState(initialData.brand_name ?? '')
  const [countryOfOrigin, setCountryOfOrigin] = useState(initialData.country_of_origin ?? '')
  const [variants, setVariants] = useState<VariantRow[]>(toVariantRows(initialData.variants))
  const [shelfLife, setShelfLife] = useState(initialData.shelf_life ?? '')
  const [shelfLifePeriod, setShelfLifePeriod] = useState(initialData.shelf_life_period_type ?? '')
  const [hasProductionDate, setHasProductionDate] = useState(boolToChoice(initialData.has_production_date))
  const [hasExpiryDate, setHasExpiryDate] = useState(boolToChoice(initialData.has_expiry_date))
  const [hasBatchNumber, setHasBatchNumber] = useState(boolToChoice(initialData.has_batch_number))
  const [hasPao, setHasPao] = useState(boolToChoice(initialData.has_period_after_opening))
  const [group, setGroup] = useState(initialData.montaji_group ?? '')
  const [category, setCategory] = useState(initialData.montaji_category ?? '')
  const [subCategory, setSubCategory] = useState(initialData.montaji_sub_category ?? '')
  const [confidence, setConfidence] = useState<Confidence | undefined>(
    initialData.classification_confidence,
  )

  const [saving, setSaving] = useState<'save' | 'ready' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedNotice, setSavedNotice] = useState<string | null>(null)

  function buildData(): ExtractedProductData {
    return {
      product_name: productName.trim() || undefined,
      product_type: productType.trim() || undefined,
      manufacturer_name: manufacturerName.trim() || undefined,
      manufacturer_country: manufacturerCountry.trim() || undefined,
      manufacturer_address: manufacturerAddress.trim() || undefined,
      certificate_number: certificateNumber.trim() || undefined,
      certificate_issuing_country: certificateCountry.trim() || undefined,
      certificate_product_match: initialData.certificate_product_match,
      certificate_matched_text: initialData.certificate_matched_text,
      certificate_products_listed: initialData.certificate_products_listed,
      document_mismatches: initialData.document_mismatches,
      document_inventory: initialData.document_inventory,
      products_found: initialData.products_found,
      label_claims: labelClaims
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean),
      notes: notes.trim() || undefined,
      brand_name: brandName.trim() || undefined,
      country_of_origin: countryOfOrigin.trim() || undefined,
      variants: variants.map((v) => ({
        barcode: v.barcode?.trim() || undefined,
        color_shade: v.color_shade?.trim() || 'NA',
        scent_flavor: v.scent_flavor?.trim() || 'NA',
        size_volume: v.size_volume?.trim() || undefined,
        volume_unit: v.volume_unit || undefined,
      })),
      shelf_life: shelfLife.trim() || undefined,
      shelf_life_period_type: shelfLifePeriod || undefined,
      has_production_date: choiceToBool(hasProductionDate),
      has_expiry_date: choiceToBool(hasExpiryDate),
      has_batch_number: choiceToBool(hasBatchNumber),
      has_period_after_opening: choiceToBool(hasPao),
      montaji_group: group || undefined,
      montaji_category: category || undefined,
      montaji_sub_category: subCategory || undefined,
      classification_confidence: group && category ? confidence : undefined,
      ingredients: ingredients
        .filter((i) => i.inci_name.trim())
        .map((i) => ({
          inci_name: i.inci_name.trim(),
          percentage: i.percentage?.trim() || undefined,
          // Not shown in the form; kept for the regulatory check, which matches banned lists by CAS.
          cas_number: i.cas_number?.trim() || undefined,
        })),
    }
  }

  const readinessIssues = montajiReadinessIssues(buildData())

  async function handleSave(markReady: boolean) {
    // Marking ready is advisory, but if things are still missing or doubtful, say so first.
    if (markReady) {
      const data = buildData()
      const issues = [...documentWarnings(data), ...montajiReadinessIssues(data)]
      if (issues.length > 0) {
        const shown = issues
          .slice(0, 6)
          .map((i) => `\u2022 ${i}`)
          .join('\n')
        const more = issues.length > 6 ? `\n...and ${issues.length - 6} more` : ''
        if (!window.confirm(`Some things are still missing or doubtful:\n\n${shown}${more}\n\nMark this product ready anyway?`)) {
          return
        }
      }
    }
    setSaving(markReady ? 'ready' : 'save')
    setError(null)
    setSavedNotice(null)
    const { error } = await onSave(buildData(), { markReady })
    setSaving(null)
    if (error) setError(error)
    else setSavedNotice(markReady ? 'Saved and marked ready to fill.' : 'Changes saved.')
  }

  function updateIngredient(key: string, field: keyof ExtractedIngredient, value: string) {
    setIngredients((rows) => rows.map((r) => (r._key === key ? { ...r, [field]: value } : r)))
  }

  function removeIngredient(key: string) {
    setIngredients((rows) => rows.filter((r) => r._key !== key))
  }

  function addIngredient() {
    setIngredients((rows) => [...rows, { _key: newKey(), inci_name: '', percentage: '' }])
  }

  function updateVariant(key: string, field: keyof ExtractedVariant, value: string) {
    setVariants((rows) => rows.map((r) => (r._key === key ? { ...r, [field]: value } : r)))
  }

  function removeVariant(key: string) {
    setVariants((rows) => (rows.length > 1 ? rows.filter((r) => r._key !== key) : rows))
  }

  function addVariant() {
    setVariants((rows) => [...rows, { _key: newKey(), color_shade: 'NA', scent_flavor: 'NA' }])
  }

  // A person changing the classification is the confirmation, so it stops being flagged.
  function changeGroup(next: string) {
    setGroup(next)
    setCategory('')
    setSubCategory('')
    setConfidence('high')
  }

  function changeCategory(next: string) {
    setCategory(next)
    const subs = subCategoriesFor(group, next)
    setSubCategory(subs.includes('Undefined') ? 'Undefined' : (subs[0] ?? ''))
    setConfidence('high')
  }

  const subOptions = subCategoriesFor(group, category)
  const needsClassificationReview = !group || !category || confidence === 'low' || confidence === 'medium'

  return (
    <div className="flex flex-col gap-5 rounded-lg border border-hairline bg-canvas-parchment p-6">
      <p className="font-text text-[13px] font-semibold uppercase tracking-[0.231px] text-status-extracted">
        Review &amp; edit before use
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Product name</span>
          <input
            className={inputClass}
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Product type</span>
          <input
            className={inputClass}
            value={productType}
            onChange={(e) => setProductType(e.target.value)}
            placeholder="e.g. Face Serum"
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Brand</span>
          <input
            className={inputClass}
            value={brandName}
            onChange={(e) => setBrandName(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Country of origin</span>
          <input
            className={inputClass}
            value={countryOfOrigin}
            onChange={(e) => setCountryOfOrigin(e.target.value)}
            placeholder="Where the product is manufactured"
          />
        </label>
      </div>
      {countryOfOrigin.trim() && (
        <p className="font-text text-[13px] text-ink-muted-80">
          {isUae(countryOfOrigin)
            ? 'Made in the UAE: Montaji will ask for a GMP certificate.'
            : 'Made outside the UAE: Montaji will ask for a Certificate of Free Sale.'}
        </p>
      )}

      <div className="flex flex-col gap-3 rounded-lg border border-hairline bg-canvas p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={labelClass}>Montaji classification</span>
          {group && category && confidence && (
            <span
              className={`font-text text-[12px] ${
                confidence === 'high' ? 'text-status-approved' : 'text-status-submitted'
              }`}
            >
              AI confidence: {confidence}
            </span>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className={labelClass}>Group</span>
            <select
              className={inputClass}
              value={group}
              onChange={(e) => changeGroup(e.target.value)}
            >
              <option value="">Select…</option>
              {MONTAJI_GROUPS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Category</span>
            <select
              className={inputClass}
              value={category}
              disabled={!group}
              onChange={(e) => changeCategory(e.target.value)}
            >
              <option value="">Select…</option>
              {categoriesForGroup(group).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Sub-category</span>
            <select
              className={inputClass}
              value={subCategory}
              disabled={!category}
              onChange={(e) => setSubCategory(e.target.value)}
            >
              <option value="">Select…</option>
              {subOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
        {needsClassificationReview && (
          <p className="font-text text-[13px] text-status-submitted">
            {!group || !category
              ? 'No valid Montaji category was chosen. Please pick one.'
              : 'The AI was not fully sure about this one. Please confirm it before filling Montaji.'}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <span className={labelClass}>
          Variants (one per shade / scent / size, each with its own barcode)
        </span>
        {variants.map((v, index) => (
          <div
            key={v._key}
            className="flex flex-col gap-3 rounded-lg border border-hairline bg-canvas p-4"
          >
            <div className="flex items-center justify-between">
              <span className="font-text text-[13px] font-semibold text-ink">
                Variant {index + 1}
              </span>
              {variants.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeVariant(v._key)}
                  className="font-text text-[13px] text-status-rejected"
                >
                  Remove
                </button>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className={labelClass}>International barcode</span>
                <input
                  className={inputClass}
                  value={v.barcode ?? ''}
                  onChange={(e) => updateVariant(v._key, 'barcode', e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={labelClass}>Colour / shade (manufacturer's code or name)</span>
                <input
                  className={inputClass}
                  value={v.color_shade ?? ''}
                  onChange={(e) => updateVariant(v._key, 'color_shade', e.target.value)}
                  placeholder="e.g. 126, or NA"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={labelClass}>Scent / flavour</span>
                <input
                  className={inputClass}
                  value={v.scent_flavor ?? ''}
                  onChange={(e) => updateVariant(v._key, 'scent_flavor', e.target.value)}
                  placeholder="or NA"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className={labelClass}>Size / volume</span>
                  <input
                    className={inputClass}
                    value={v.size_volume ?? ''}
                    onChange={(e) => updateVariant(v._key, 'size_volume', e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={labelClass}>Unit</span>
                  <select
                    className={inputClass}
                    value={v.volume_unit ?? ''}
                    onChange={(e) => updateVariant(v._key, 'volume_unit', e.target.value)}
                  >
                    <option value="">Select…</option>
                    {VOLUME_UNITS.map((u) => (
                      <option key={u} value={u}>
                        {u === 'Soft_Gel' ? 'Soft Gel' : u}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={addVariant}
          className="self-start font-text text-[14px] text-primary"
        >
          + Add variant
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <span className={labelClass}>Ingredients (INCI name + %)</span>
        <div className="flex flex-col gap-2">
          {ingredients.map((row) => (
            <div key={row._key} className="flex gap-2">
              <input
                className={`${inputBase} min-w-0 flex-1`}
                value={row.inci_name}
                onChange={(e) => updateIngredient(row._key, 'inci_name', e.target.value)}
                placeholder="INCI name"
              />
              <input
                className={`${inputBase} w-24 shrink-0`}
                value={row.percentage ?? ''}
                onChange={(e) => updateIngredient(row._key, 'percentage', e.target.value)}
                placeholder="%"
              />
              <button
                type="button"
                onClick={() => removeIngredient(row._key)}
                className="shrink-0 font-text text-[13px] text-status-rejected"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addIngredient}
          className="self-start font-text text-[14px] text-primary"
        >
          + Add ingredient
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Manufacturer name</span>
          <input
            className={inputClass}
            value={manufacturerName}
            onChange={(e) => setManufacturerName(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Manufacturer country</span>
          <input
            className={inputClass}
            value={manufacturerCountry}
            onChange={(e) => setManufacturerCountry(e.target.value)}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Manufacturer address</span>
        <textarea
          className={textareaClass}
          rows={2}
          value={manufacturerAddress}
          onChange={(e) => setManufacturerAddress(e.target.value)}
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Certificate of Free Sale number</span>
          <input
            className={inputClass}
            value={certificateNumber}
            onChange={(e) => setCertificateNumber(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Certificate issuing country</span>
          <input
            className={inputClass}
            value={certificateCountry}
            onChange={(e) => setCertificateCountry(e.target.value)}
          />
        </label>
      </div>

      <div className="flex flex-col gap-3">
        <span className={labelClass}>Shelf life and label dates (optional)</span>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Shelf life</span>
            <input
              className={inputClass}
              value={shelfLife}
              onChange={(e) => setShelfLife(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Shelf life period</span>
            <select
              className={inputClass}
              value={shelfLifePeriod}
              onChange={(e) => setShelfLifePeriod(e.target.value)}
            >
              <option value="">Select…</option>
              {SHELF_LIFE_PERIOD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            ['Has production date', hasProductionDate, setHasProductionDate],
            ['Has expiry date', hasExpiryDate, setHasExpiryDate],
            ['Has batch number', hasBatchNumber, setHasBatchNumber],
            ['Has period after opening', hasPao, setHasPao],
          ].map(([label, value, setter]) => (
            <label key={label as string} className="flex flex-col gap-1.5">
              <span className={labelClass}>{label as string}</span>
              <select
                className={inputClass}
                value={value as string}
                onChange={(e) => (setter as (v: string) => void)(e.target.value)}
              >
                <option value="">Not set</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
          ))}
        </div>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Label claims (comma-separated)</span>
        <input
          className={inputClass}
          value={labelClaims}
          onChange={(e) => setLabelClaims(e.target.value)}
          placeholder="Paraben-free, Cruelty-free, SPF 30"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Notes for review</span>
        <textarea
          className={textareaClass}
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>

      {readinessIssues.length > 0 && (
        <div className="flex flex-col gap-1 rounded-[18px] border border-hairline p-4">
          <p className="font-text text-[14px] font-semibold text-ink">
            Before you send this to Montaji
          </p>
          <ul className="list-disc pl-5 font-text text-[14px] leading-[1.47] text-ink-muted-80">
            {readinessIssues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => handleSave(false)}
          disabled={saving !== null}
          className="rounded-full border border-hairline px-[18px] py-[10px] font-text text-[15px] text-ink active:scale-95 transition-transform disabled:opacity-60"
        >
          {saving === 'save' ? 'Saving…' : 'Save changes'}
        </button>
        <button
          type="button"
          onClick={() => handleSave(true)}
          disabled={saving !== null}
          className="rounded-full bg-primary px-[18px] py-[10px] font-text text-[15px] text-on-primary active:scale-95 transition-transform disabled:opacity-60"
        >
          {saving === 'ready' ? 'Saving…' : 'Save & mark ready to fill'}
        </button>
      </div>

      {error && <p className="font-text text-[14px] text-status-rejected">{error}</p>}
      {savedNotice && !error && (
        <p className="font-text text-[14px] text-status-approved">{savedNotice}</p>
      )}
    </div>
  )
}
