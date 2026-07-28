export default function HeroGraphic() {
  return (
    <svg
      viewBox="0 0 560 360"
      className="w-full max-w-[560px]"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Documents feeding into a completed Montaji form"
    >
      <g style={{ filter: 'drop-shadow(3px 5px 20px rgba(0,0,0,0.18))' }}>
        {/* stacked source documents */}
        <g transform="translate(48,96) rotate(-6)">
          <rect x="0" y="0" width="150" height="196" rx="10" fill="#ffffff" stroke="#e0e0e0" />
          <rect x="18" y="26" width="90" height="10" rx="5" fill="#e0e0e0" />
          <rect x="18" y="50" width="114" height="7" rx="3.5" fill="#f0f0f0" />
          <rect x="18" y="66" width="114" height="7" rx="3.5" fill="#f0f0f0" />
          <rect x="18" y="82" width="80" height="7" rx="3.5" fill="#f0f0f0" />
        </g>
        <g transform="translate(64,80) rotate(3)">
          <rect x="0" y="0" width="150" height="196" rx="10" fill="#ffffff" stroke="#e0e0e0" />
          <rect x="18" y="26" width="70" height="10" rx="5" fill="#e0e0e0" />
          <rect x="18" y="50" width="114" height="7" rx="3.5" fill="#f0f0f0" />
          <rect x="18" y="66" width="90" height="7" rx="3.5" fill="#f0f0f0" />
        </g>

        {/* arrow */}
        <path d="M232 178 L288 178" stroke="#7a7a7a" strokeWidth="2" />
        <path d="M280 170 L290 178 L280 186" stroke="#7a7a7a" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />

        {/* resulting form */}
        <g transform="translate(316,52)">
          <rect x="0" y="0" width="196" height="248" rx="14" fill="#ffffff" stroke="#e0e0e0" />
          <rect x="24" y="28" width="120" height="12" rx="6" fill="#1d1d1f" />

          <rect x="24" y="62" width="148" height="9" rx="4.5" fill="#f0f0f0" />
          <rect x="24" y="79" width="90" height="9" rx="4.5" fill="#0066cc" opacity="0.12" />
          <circle cx="160" cy="83.5" r="7" fill="#0066cc" />
          <path d="M156.5 83.5 L159 86 L164 80.5" stroke="#ffffff" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />

          <rect x="24" y="104" width="148" height="9" rx="4.5" fill="#f0f0f0" />
          <rect x="24" y="121" width="90" height="9" rx="4.5" fill="#0066cc" opacity="0.12" />
          <circle cx="160" cy="125.5" r="7" fill="#0066cc" />
          <path d="M156.5 125.5 L159 128 L164 122.5" stroke="#ffffff" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />

          <rect x="24" y="146" width="148" height="9" rx="4.5" fill="#f0f0f0" />
          <rect x="24" y="163" width="90" height="9" rx="4.5" fill="#0066cc" opacity="0.12" />
          <circle cx="160" cy="167.5" r="7" fill="#0066cc" />
          <path d="M156.5 167.5 L159 170 L164 164.5" stroke="#ffffff" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />

          <rect x="24" y="204" width="148" height="30" rx="15" fill="#0066cc" />
          <text x="98" y="223" textAnchor="middle" fontFamily="Inter, system-ui, sans-serif" fontSize="12" fill="#ffffff">Ready to fill</text>
        </g>
      </g>
    </svg>
  )
}
