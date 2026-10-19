export default function Logo({ height = 28, className = '' }) {
  return (
    <img
      src="/5ostudios-logo-dark.svg"
      alt="Fifty Studios"
      height={height}
      className={className}
      style={{ display: 'block', height, width: 'auto' }}
    />
  )
}
