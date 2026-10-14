import { type FormEvent, useId, useState } from 'react';

/**
 * A form built from a JSON Schema: the subset the play-test's response
 * schemas use (objects, arrays, strings, numbers, booleans, enums). It only
 * shapes the input; the game validates the reply and sends back anything
 * that's wrong, as it would for a model.
 */

export interface Schema {
  type?: string;
  title?: string;
  description?: string;
  properties?: Record<string, Schema>;
  items?: Schema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
}

/** An empty value of the schema's shape, to start a form or a new array item from. */
export function defaultValue(schema: Schema): unknown {
  if (schema.enum) return schema.enum[0];
  switch (schema.type) {
    case 'object':
      return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([k, s]) => [k, defaultValue(s)]));
    case 'array':
      return [];
    case 'integer':
    case 'number':
      return schema.minimum ?? 0;
    case 'boolean':
      return false;
    default:
      return '';
  }
}

/** `instant_intel_requests` → `Instant intel requests`. */
export function humanize(key: string): string {
  const words = key.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

interface FieldProps {
  schema: Schema;
  value: unknown;
  onChange: (value: unknown) => void;
  label: string;
}

function Field({ schema, value, onChange, label }: FieldProps) {
  const id = useId();
  const help = schema.description ? <p className="field-help">{schema.description}</p> : null;

  if (schema.enum) {
    return (
      <div className="field">
        <label htmlFor={id}>{label}</label>
        {help}
        <select id={id} value={String(value)} onChange={(e) => onChange(schema.enum?.find((o) => String(o) === e.target.value))}>
          {schema.enum.map((o) => (
            <option key={String(o)} value={String(o)}>
              {String(o)}
            </option>
          ))}
        </select>
      </div>
    );
  }

  switch (schema.type) {
    case 'object': {
      const object = (value ?? {}) as Record<string, unknown>;
      return (
        <fieldset className="field-object">
          <legend>{label}</legend>
          {help}
          {Object.entries(schema.properties ?? {}).map(([key, s]) => (
            <Field key={key} schema={s} label={humanize(key)} value={object[key]} onChange={(v) => onChange({ ...object, [key]: v })} />
          ))}
        </fieldset>
      );
    }

    case 'array': {
      const items = (Array.isArray(value) ? value : []) as unknown[];
      const itemSchema = schema.items ?? {};
      const set = (next: unknown[]) => onChange(next);
      return (
        <fieldset className="field-array">
          <legend>{label}</legend>
          {help}
          {items.map((item, i) => (
            <div className="array-item" key={i}>
              <Field
                schema={itemSchema}
                label={`${label} ${i + 1}`}
                value={item}
                onChange={(v) => set(items.map((old, j) => (j === i ? v : old)))}
              />
              <button type="button" className="secondary" onClick={() => set(items.filter((_, j) => j !== i))}>
                Remove
              </button>
            </div>
          ))}
          <button type="button" className="secondary" onClick={() => set([...items, defaultValue(itemSchema)])}>
            Add to {label.toLowerCase()}
          </button>
        </fieldset>
      );
    }

    case 'integer':
    case 'number':
      return (
        <div className="field">
          <label htmlFor={id}>{label}</label>
          {help}
          <input
            id={id}
            type="number"
            step={schema.type === 'integer' ? 1 : 'any'}
            min={schema.minimum}
            max={schema.maximum}
            value={typeof value === 'number' ? value : ''}
            onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
          />
        </div>
      );

    case 'boolean':
      return (
        <div className="field field-inline">
          <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          <label htmlFor={id}>{label}</label>
          {help}
        </div>
      );

    case 'string':
      return (
        <div className="field">
          <label htmlFor={id}>{label}</label>
          {help}
          <textarea id={id} rows={2} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />
        </div>
      );

    default:
      // A shape this form doesn't know: edit it as raw JSON.
      return (
        <div className="field">
          <label htmlFor={id}>{label} (JSON)</label>
          {help}
          <textarea
            id={id}
            rows={4}
            defaultValue={JSON.stringify(value ?? null, null, 2)}
            onChange={(e) => {
              try {
                onChange(JSON.parse(e.target.value));
              } catch {
                // Keep the last valid value until the JSON parses.
              }
            }}
          />
        </div>
      );
  }
}

export interface SchemaFormProps {
  schema: Schema;
  /** Starting values, e.g. the last reply when it was sent back to be fixed. */
  initial?: unknown;
  onSubmit: (value: unknown) => void;
  disabled?: boolean;
}

export function SchemaForm({ schema, initial, onSubmit, disabled }: SchemaFormProps) {
  const [value, setValue] = useState<unknown>(() => initial ?? defaultValue(schema));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(value);
  };
  const fields =
    schema.type === 'object'
      ? Object.entries(schema.properties ?? {}).map(([key, s]) => {
          const object = (value ?? {}) as Record<string, unknown>;
          return <Field key={key} schema={s} label={humanize(key)} value={object[key]} onChange={(v) => setValue({ ...object, [key]: v })} />;
        })
      : [<Field key="value" schema={schema} label="Reply" value={value} onChange={setValue} />];

  return (
    <form className="schema-form" onSubmit={submit}>
      {fields}
      <button type="submit" disabled={disabled}>
        Send
      </button>
    </form>
  );
}
