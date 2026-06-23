export function StatusChip({ children, tone = "neutral" }) {
  return <span className={`status-chip status-${tone}`}>{children}</span>;
}

export function Panel({ title, description, actions, children, onClose }) {
  return (
    <section className="panel">
      {(title || actions || onClose) && (
        <div className="panel-head">
          <div>
            {title ? <h3>{title}</h3> : null}
            {description ? <p>{description}</p> : null}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {actions}
            {onClose ? <button className="ghost-button" type="button" onClick={onClose}>收起</button> : null}
          </div>
        </div>
      )}
      {children}
    </section>
  );
}

export function Table({ columns, rows, renderRow }) {
  return (
    <table className="table-wrap">
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column}>{column}</th>
          ))}
        </tr>
      </thead>
      <tbody>{rows.map(renderRow)}</tbody>
    </table>
  );
}
