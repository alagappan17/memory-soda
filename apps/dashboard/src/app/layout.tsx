import './global.css';
import { Geist } from 'next/font/google';
import { cn } from '@/lib/utils';
import QueryProvider from '@/providers/query-provider';
import { ProjectProvider } from '@/providers/project-provider';
import Nav from '@/components/nav';

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });

export const metadata = {
  title: 'memory-soda',
  description: 'Developer console for memory-soda',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={cn('font-sans', geist.variable)}>
      <body className="bg-background text-foreground min-h-screen">
        <QueryProvider>
          <ProjectProvider>
            <Nav />
            <main>{children}</main>
          </ProjectProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
