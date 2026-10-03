import { useState } from 'react'
import type { ExtractedProductData, ExtractedIngredient } from '../lib/types'

type IngredientRow = ExtractedIngredient & { _key: string }

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
      label_claims: labelClaims
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean),
      notes: notes.trim() || undefined,
      ingredients: ingredients
        .filter((i) => i.inci_name.trim())
        .map((i) => ({
          inci_name: i.inci_name.trim(),
          percentage: i.percentage?.trim() || undefined,
        })),
    }
  }

  async function handleSave(markReady: boolean) {
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
