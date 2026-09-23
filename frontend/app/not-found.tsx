import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-sm px-4 py-24 text-center">
      <h1 className="text-xl font-bold text-slate-900">Page not found</h1>
      <p className="mt-1 text-sm text-slate-500">The page or task does not exist, or you do not have access to it.</p>
      <Link href="/" className="mt-4 inline-block font-semibold text-brand-700">
        Back to home
      </Link>
    </main>
  );
}
