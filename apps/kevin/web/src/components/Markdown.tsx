import { memo, type MouseEvent } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { useNavigate } from 'react-router';
import remarkGfm from 'remark-gfm';
import { leaveSheetForLink } from '@/lib/chat';
import { appPath, remarkAppLinks } from '@/lib/links';
import { cn } from '@/lib/utils';

const plugins = [remarkGfm, remarkAppLinks];

/**
 * Renders model-written markdown. react-markdown never interprets raw HTML
 * (no rehype-raw), and its default URL filter drops javascript: links. Images
 * are not loaded: a reply must not be able to make the browser fetch a URL.
 * In-app paths Kevin writes in prose ("/s/car-maintenance") become router links.
 */
function MarkdownImpl({ text, className }: { text: string; className?: string }) {
  const navigate = useNavigate();
  const components: Components = {
    a({ href, children }) {
      const path = appPath(href);
      const internal = path !== null;
      const go = (e: MouseEvent) => {
        if (path === null || e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        // On a phone the chat covers the page: get it out of the way of where the link goes.
        void navigate(path, leaveSheetForLink());
      };
      return (
        <a href={href} onClick={go} {...(internal ? {} : { target: '_blank', rel: 'noopener noreferrer' })}>
          {children}
        </a>
      );
    },
    img({ alt, src }) {
      return typeof src === 'string' && src.startsWith('/api/attachments/') ? <img src={src} alt={alt ?? ''} className="max-h-72 rounded-lg" /> : <span>{alt || 'image'}</span>;
    },
    table({ children }) {
      return (
        <div className="table-wrap">
          <table>{children}</table>
        </div>
      );
    },
  };
  return (
    <div className={cn('prose-kevin', className)}>
      <ReactMarkdown remarkPlugins={plugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownImpl);
