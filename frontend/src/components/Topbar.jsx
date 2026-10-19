export default function Topbar({ title, subtitle, actions }) {
  return (
    <header className="topbar">
      <div className="topbar-title">
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="topbar-actions">{actions}</div>}
    </header>
  )
}
