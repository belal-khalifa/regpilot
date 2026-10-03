import { PRODUCT_STATUS_LABELS, type ProductStatus } from '../lib/types'

const STATUSES: ProductStatus[] = [
  'draft',
  'extracted',
  'ready_to_fill',
  'submitted',
  'approved',
  'rejected',
]

export default function StatusSelect({
  status,
  onChange,
  disabled,
}: {
  status: ProductStatus
  onChange: (next: ProductStatus) => void
  disabled?: boolean
}) {
  return (
    <select
      value={status}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as ProductStatus)}
      className="rounded-full border border-hairline bg-canvas px-4 py-2 font-text text-[14px] text-ink outline-none focus:border-primary disabled:opacity-60"
    >
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {PRODUCT_STATUS_LABELS[s]}
        </option>
      ))}
    </select>
  )
}
