import { isRouteErrorResponse, useRouteError } from 'react-router'

/** Kept literal rather than read off `package.json` — it's the one thing this page must not fail
 *  to know, and importing JSON at runtime is one more thing that could go wrong on a broken page. */
const REPO = 'kael-k/riichi-trainer'
/** GitHub's own issue-body length limit is generous, but a stack trace from a tight recursive loop
 *  can run to tens of thousands of characters — cropped rather than silently dropped by GitHub. */
const MAX_STACK = 4000

function describeError(error: unknown): { message: string; stack?: string } {
  if (isRouteErrorResponse(error)) return { message: `${error.status} ${error.statusText}` }
  if (error instanceof Error) return { message: error.message, stack: error.stack }
  if (typeof error === 'string') return { message: error }
  return { message: 'Unknown error' }
}

function issueUrl(
  message: string,
  stack: string | undefined,
  href: string,
  trainer: string,
): string {
  const body = [
    '**Describe the bug**',
    'The app crashed unexpectedly. Replace this line with what you were doing when it happened.',
    '',
    '**Steps to reproduce** 1. 2. 3.',
    '',
    '**Situation link**',
    href,
    '',
    '**Environment**',
    '',
    `- Browser/OS: ${navigator.userAgent}`,
    `- Trainer: ${trainer}`,
    '',
    '**Additional context**',
    '```',
    message,
    '',
    stack ? stack.slice(0, MAX_STACK) : '(no stack trace available)',
    '```',
  ].join('\n')
  const params = new URLSearchParams({
    template: 'bug_report.md',
    title: `Crash: ${message}`.slice(0, 100),
    body,
  })
  return `https://github.com/${REPO}/issues/new?${params.toString()}`
}

/** The router's top-level `errorElement`: whatever crashed, this replaces the whole tree rather
 *  than nesting under it, since the crash may well be in `AppShell` itself. Deliberately not
 *  translated — a page that has to survive the rest of the app breaking should not also depend on
 *  the i18n system being intact. */
export function CrashPage() {
  const error = useRouteError()
  const { message, stack } = describeError(error)
  const href = window.location.href
  const trainer = new URL(href).pathname.split('/').filter(Boolean).pop() ?? 'home'
  const base = import.meta.env.BASE_URL

  return (
    <div className="flex min-h-svh items-center justify-center bg-neutral-50 p-4 dark:bg-neutral-950">
      <div className="w-full max-w-lg rounded-lg border border-neutral-300 bg-white p-6 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Something went wrong
        </h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          This trainer hit a bug and had to stop. Reporting it takes one click below — the details
          are already filled in.
        </p>

        <p className="mt-4 font-mono text-sm break-words text-red-600 dark:text-red-400">
          {message}
        </p>

        {stack && (
          <details className="mt-2">
            <summary className="cursor-pointer text-sm text-neutral-600 dark:text-neutral-400">
              Stack trace
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded bg-neutral-100 p-2 text-xs text-neutral-800 dark:bg-neutral-950 dark:text-neutral-300">
              {stack}
            </pre>
          </details>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          <a
            href={issueUrl(message, stack, href, trainer)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-11 items-center rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
          >
            Report on GitHub
          </a>
          <a
            href={base}
            className="flex min-h-11 items-center rounded-lg border border-neutral-300 px-4 text-sm font-medium text-neutral-900 dark:border-neutral-700 dark:text-neutral-100"
          >
            Back to home
          </a>
        </div>
      </div>
    </div>
  )
}
