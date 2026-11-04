import { Suspense } from "react";
import { ReaderDemo } from "./reader-demo";

export const metadata = { title: "Anagnosis · Reader" };

/** Dev-only reader harness: /dev/reader?fixture=<manifest id>, or open your own PDF in memory. */
export default function DevReaderPage() {
  return (
    <Suspense fallback={null}>
      <ReaderDemo />
    </Suspense>
  );
}
