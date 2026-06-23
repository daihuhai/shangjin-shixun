export function LoadState({ loading, error, children }) {
  if (loading) {
    return <div className="panel">正在加载数据...</div>;
  }
  if (error) {
    return <div className="panel error-text">{error}</div>;
  }
  return children;
}
