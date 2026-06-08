"use client";

import { Loader2, Mail, Plus, Save, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { savePartnerKnowledgeAction } from "@/app/partner-knowledge/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Markdown } from "@/components/markdown";

interface Contact {
  email: string;
  name: string;
  role: string;
}

function parseContactsFromFrontmatter(fm: Record<string, unknown>): Contact[] {
  const raw = fm["contacts"];
  if (!Array.isArray(raw)) return [];
  const out: Contact[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const email = typeof obj.email === "string" ? obj.email : "";
    out.push({
      email,
      name: typeof obj.name === "string" ? obj.name : "",
      role: typeof obj.role === "string" ? obj.role : "",
    });
  }
  return out;
}

// Build the frontmatter-shaped contacts list. Drops rows with empty
// email (the load-bearing field) and omits empty optional fields so
// the YAML stays clean.
function contactsToFrontmatter(
  contacts: Contact[],
): Array<Record<string, string>> {
  const out: Array<Record<string, string>> = [];
  for (const c of contacts) {
    const email = c.email.trim();
    if (!email) continue;
    const entry: Record<string, string> = { email };
    const name = c.name.trim();
    const role = c.role.trim();
    if (name) entry.name = name;
    if (role) entry.role = role;
    out.push(entry);
  }
  return out;
}

function contactsEqual(a: Contact[], b: Contact[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i]!.email !== b[i]!.email ||
      a[i]!.name !== b[i]!.name ||
      a[i]!.role !== b[i]!.role
    ) {
      return false;
    }
  }
  return true;
}

interface Props {
  partnerSlug: string;
  initialBody: string;
  initialFrontmatter: Record<string, unknown>;
  /** True when the file didn't exist yet — first-save creates it. */
  isNewFile: boolean;
}

/**
 * Two-pane editor for `knowledge/partners/<slug>/partner-knowledge.md`.
 * Body is a textarea + preview toggle, mirroring the weekly-update +
 * draft editors. Save round-trips through HM MCP — preserves any
 * frontmatter fields the user didn't touch and stamps `updated` to
 * today, matching what the /update-knowledge skill would do.
 *
 * v1 deliberately scopes to body-only edits. Structured frontmatter
 * fields (title / description / team) stay editable via the existing
 * project-metadata modal + brief wizard inputs; a future slice could
 * surface a dedicated frontmatter form here.
 */
export function PartnerKnowledgeEditor({
  partnerSlug,
  initialBody,
  initialFrontmatter,
  isNewFile,
}: Props) {
  const [body, setBody] = React.useState(initialBody);
  const [saving, setSaving] = React.useState(false);
  const [showPreview, setShowPreview] = React.useState(false);

  const initialContacts = React.useMemo(
    () => parseContactsFromFrontmatter(initialFrontmatter),
    [initialFrontmatter],
  );
  const [contacts, setContacts] = React.useState<Contact[]>(initialContacts);

  const bodyDirty = body !== initialBody;
  const contactsDirty = !contactsEqual(contacts, initialContacts);
  const dirty = bodyDirty || contactsDirty;

  // The contacts editor consumes the existing `contacts:` frontmatter
  // field, so suppress it from the read-only display below to avoid
  // duplicating the data.
  const frontmatterEntries = Object.entries(initialFrontmatter).filter(
    ([key]) => key !== "contacts",
  );

  function updateContact(index: number, patch: Partial<Contact>) {
    setContacts((prev) =>
      prev.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    );
  }
  function addContact() {
    setContacts((prev) => [...prev, { email: "", name: "", role: "" }]);
  }
  function removeContact(index: number) {
    setContacts((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    if (!body.trim()) {
      toast.error("Body can't be empty.");
      return;
    }
    // Soft-validate emails so save doesn't silently drop a typo. The
    // server still trims + drops empty-email rows, but a malformed
    // input is more often a user mistake than intent.
    const malformed = contacts.filter(
      (c) => c.email.trim() && !c.email.includes("@"),
    );
    if (malformed.length > 0) {
      toast.error(
        `Email looks malformed: "${malformed[0]!.email.trim()}" — fix or remove the row.`,
      );
      return;
    }

    setSaving(true);
    try {
      const frontmatterPatch = contactsDirty
        ? { contacts: contactsToFrontmatter(contacts) }
        : undefined;
      const res = await savePartnerKnowledgeAction({
        partnerSlug,
        body,
        frontmatter: frontmatterPatch,
      });
      if (!res.ok) {
        toast.error(res.reason);
        return;
      }
      toast.success(`Saved to ${res.relative_path}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {isNewFile ? (
        <Card className="border-amber-200 dark:border-amber-900/50">
          <CardContent className="py-3 text-sm">
            <p>
              No <code className="bg-muted rounded px-1 font-mono">partner-knowledge.md</code>{" "}
              found for <code className="bg-muted rounded px-1 font-mono">{partnerSlug}</code>.
              Saving will create it.
            </p>
          </CardContent>
        </Card>
      ) : frontmatterEntries.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Frontmatter (read-only)</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-muted-foreground mb-1.5 text-[11px]">
              Preserved across save except <code className="font-mono">updated</code>,
              which gets stamped to today.
            </p>
            <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 text-xs">
              {frontmatterEntries.map(([key, value]) => (
                <React.Fragment key={key}>
                  <dt className="text-muted-foreground font-mono">{key}</dt>
                  <dd className="text-foreground break-all">
                    {formatFrontmatterValue(value)}
                  </dd>
                </React.Fragment>
              ))}
            </dl>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Mail className="size-3.5" />
            Contacts
            <span className="text-muted-foreground ml-auto text-[11px] font-normal">
              {contacts.length === 0 ? "none" : `${contacts.length} entries`}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-muted-foreground mb-2 text-xs">
            Powers Smithers&apos; Suggested-tickets surface — Zendesk searches
            fan out across these emails to catch unattached threads. Email is
            required; name and role are display-only.
          </p>
          {contacts.length === 0 ? (
            <p className="text-muted-foreground text-xs italic">
              No contacts yet. Add one below.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {contacts.map((c, i) => (
                <li
                  key={i}
                  className="grid grid-cols-[2fr_1.5fr_1.5fr_auto] gap-2"
                >
                  <input
                    type="email"
                    value={c.email}
                    onChange={(e) =>
                      updateContact(i, { email: e.target.value })
                    }
                    placeholder="email@example.com"
                    disabled={saving}
                    className="border-input bg-background focus-visible:ring-ring rounded-md border px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-1"
                  />
                  <input
                    type="text"
                    value={c.name}
                    onChange={(e) =>
                      updateContact(i, { name: e.target.value })
                    }
                    placeholder="Name (optional)"
                    disabled={saving}
                    className="border-input bg-background focus-visible:ring-ring rounded-md border px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-1"
                  />
                  <input
                    type="text"
                    value={c.role}
                    onChange={(e) =>
                      updateContact(i, { role: e.target.value })
                    }
                    placeholder="Role (optional)"
                    disabled={saving}
                    className="border-input bg-background focus-visible:ring-ring rounded-md border px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-1"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeContact(i)}
                    disabled={saving}
                    title="Remove"
                    aria-label={`Remove contact ${c.email || `row ${i + 1}`}`}
                    className="text-muted-foreground hover:text-destructive size-8 shrink-0 p-0"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addContact}
            disabled={saving}
            className="mt-2 gap-1.5"
          >
            <Plus className="size-3.5" />
            Add contact
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            Body
            <span className="ml-auto flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowPreview((p) => !p)}
              >
                {showPreview ? "Edit" : "Preview"}
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saving || !dirty}
                className="gap-1.5"
              >
                {saving ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                Save
              </Button>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {showPreview ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <Markdown source={body} />
            </div>
          ) : (
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={32}
              className="border-input bg-background focus-visible:ring-ring w-full resize-y rounded-md border p-3 font-mono text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-1"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function formatFrontmatterValue(value: unknown): string {
  if (value === null || value === undefined) return "(empty)";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((v) => String(v)).join(", ");
  return JSON.stringify(value);
}
