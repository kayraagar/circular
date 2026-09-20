export default function DashboardLoading() {
  return (
    <div role="status" aria-label="Yükleniyor" className="animate-pulse motion-reduce:animate-none">
      <div className="h-3 w-40 rounded bg-raised" />
      <div className="mt-3 h-9 w-56 max-w-full rounded-lg bg-raised" />
      <div className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card h-[118px]" />
        ))}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <div className="card h-80 lg:col-span-3" />
        <div className="card h-80 lg:col-span-2" />
      </div>
      <span className="sr-only">Yükleniyor…</span>
    </div>
  );
}
