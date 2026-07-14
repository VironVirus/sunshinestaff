import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";

export const metadata = {
  title: "Sunshine Hotel Staff Portal",
  description: "Role-based staff portal for Sunshine Hotel operations and departments.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#edf2f4] text-[#162338] antialiased">
        <div className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="ambient ambient-one" />
          <div className="ambient ambient-two" />
          <div className="ambient ambient-three" />
        </div>
        <div className="relative isolate flex min-h-screen flex-col">
          <div className="flex-1">
            <AuthProvider>{children}</AuthProvider>
          </div>
          <footer className="px-4 pb-6 pt-3 text-center text-sm text-slate-500">
            Powered by CONSOLish
          </footer>
        </div>
      </body>
    </html>
  );
}
