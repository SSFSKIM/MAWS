// The toolbar's model with effort (C7 execution document, "Composer frame" Model · effort): the resolved model and the
// effort; the menu lists the models the binding offers (C3's `listModels`, or C10's catalogue for an unstarted
// session) with their descriptions, and the chosen model's effort levels (every level when it names none). When C11
// registered the `/model` widget the chip opens it instead.
import { Popover } from 'radix-ui';
import { useState } from 'react';
import { EffortSchema, type Effort } from '@shared/engine/launch-spec';
import type { ModelInfo } from '../setup-intent';
import { modelMatches, type ChipBinding, type ModelChoice } from './bindings';
import { CHIP, ITEM, NOTE, POPOVER } from './chip-style';

const EFFORTS = EffortSchema.options;

const matches = modelMatches;
const displayOf = (options: readonly ModelInfo[], model: string | null) => (model === null ? 'Default model' : (options.find((m) => matches(m, model))?.displayName ?? model));

export function ModelChip({ binding, openWidget, onOpen }: { binding: ChipBinding<ModelChoice, ModelInfo>; openWidget: (() => boolean) | null; onOpen?(): void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const { model, effort } = binding.value;
  const chosen = binding.options.find((m) => matches(m, model));
  const efforts = (chosen?.supportedEffortLevels ?? EFFORTS).filter((e): e is Effort => (EFFORTS as readonly string[]).includes(e));
  const apply = async (next: ModelChoice) => {
    setPending(true);
    try {
      const result = await binding.set(next);
      setError(result.ok ? null : result.error);
    } finally {
      setPending(false);
    }
  };
  const label = `${displayOf(binding.options, model)}${effort ? ` · ${effort}` : ''}`;
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next && openWidget?.()) return; // C11's widget takes the chip
        if (next) onOpen?.();
        setOpen(next);
      }}
    >
      <Popover.Trigger aria-label={`Model ${label}`} title={binding.disabled ?? 'Model and effort'} className={CHIP}>
        {label}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content aria-label="Model" side="top" align="end" sideOffset={6} collisionPadding={8} className={`${POPOVER} flex w-72 flex-col gap-1`}>
          {binding.disabled && <p className={NOTE}>{binding.disabled}</p>}
          <div role="menu" aria-label="Models" className="flex flex-col">
            {binding.options.length === 0 && <p className={NOTE}>Reading the models…</p>}
            {binding.options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={matches(option, model)}
                disabled={pending || binding.disabled !== null}
                onClick={() => void apply({ model: option.value, effort })}
                className={ITEM}
              >
                <span>{option.displayName}</span>
                {option.description && <span className="text-ui-sm text-fg-muted">{option.description}</span>}
              </button>
            ))}
          </div>
          <div className="my-1 h-px bg-border" />
          <p className={NOTE}>Effort</p>
          <div role="menu" aria-label="Effort" className="flex flex-wrap gap-1 px-1 pb-1">
            {efforts.map((level) => (
              <button key={level} type="button" role="menuitemradio" aria-checked={level === effort} disabled={pending || binding.disabled !== null} onClick={() => void apply({ model, effort: level })} className={`${CHIP} border border-border`}>
                {level}
              </button>
            ))}
          </div>
          {error && (
            <p role="alert" className="px-2 text-ui-sm text-danger">
              {error}
            </p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
