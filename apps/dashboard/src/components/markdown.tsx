import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Markdown rendered with tight, chat-friendly spacing. Used for assistant
 * messages in the playground and the Users → Conversations chat.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
        h1: ({ children }) => <h1 className="text-base font-semibold mt-3 mb-1 first:mt-0">{children}</h1>,
        h2: ({ children }) => <h2 className="text-sm font-semibold mt-3 mb-1 first:mt-0">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-semibold mt-2 mb-1 first:mt-0">{children}</h3>,
        ul: ({ children }) => <ul className="list-disc ml-4 mb-2 space-y-0.5">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal ml-4 mb-2 space-y-0.5">{children}</ol>,
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        a: ({ children, href }) => <a href={href} className="underline" target="_blank" rel="noreferrer">{children}</a>,
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        hr: () => <hr className="my-2 border-border" />,
        code: ({ children, className }) =>
          className ? (
            <code className={`${className} block overflow-x-auto rounded bg-black/10 dark:bg-white/10 p-2 my-2 text-xs font-mono`}>{children}</code>
          ) : (
            <code className="rounded bg-black/10 dark:bg-white/10 px-1 py-0.5 text-[0.85em] font-mono">{children}</code>
          ),
        blockquote: ({ children }) => <blockquote className="border-l-2 border-border pl-3 italic my-2">{children}</blockquote>,
        table: ({ children }) => <table className="border-collapse my-2 text-xs">{children}</table>,
        th: ({ children }) => <th className="border border-border px-2 py-1 text-left font-semibold">{children}</th>,
        td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
