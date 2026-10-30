import { DataExport } from "./data-export";
import { SettingsForm } from "./settings-form";
import { InstallSection, StorageSection } from "./storage-section";

export const metadata = { title: "Settings · Margin" };

export default function SettingsPage() {
  return (
    <section className="max-w-xl space-y-6">
      <h1 className="font-semibold font-serif text-2xl">Settings</h1>
      <SettingsForm />
      <StorageSection />
      <InstallSection />
      <DataExport />
    </section>
  );
}
