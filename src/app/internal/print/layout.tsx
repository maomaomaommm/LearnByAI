import "./print.css";

export const metadata = {
  robots: { index: false, follow: false },
};

export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return children;
}
