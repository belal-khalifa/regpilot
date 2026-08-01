import { PRODUCT_STATUS_LABELS, type ProductStatus } from '../lib/types'

const DOT_COLOR: Record<ProductStatus, string> = {
  draft: 'bg-status-draft',
  extracted: 'bg-status-extracted',
  ready_to_fill: 'bg-status-ready',
  submitted: 'bg-status-submitted',
  approved: 'bg-status-approved',
  rejected: 'bg-status-rejected',
}

export default function StatusBadge({ status }: { status: ProductStatus }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-hairline px-3 py-1 font-text text-[12px] leading-[1.0] tracking-[-0.12px] text-ink-muted-80">
      <span className={`h-2 w-2 rounded-full ${DOT_COLOR[status]}`} />
      {PRODUCT_STATUS_LABELS[status]}
    </span>
  )
}
