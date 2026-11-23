// @effect-diagnostics globalDate:off -- Its submit reads the wall clock, outside any Effect runtime.
import {
  type CustomSnoozeInput,
  localSnoozeDate,
  localSnoozeTime,
  resolveCustomSnooze,
} from "@t3tools/client-runtime/state/thread-settled";
import { createSignal, createUniqueId, Show } from "solid-js";

import Environment from "./Environment";
import { Button } from "./ui/Button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/Dialog";
import { Input } from "./ui/Input";
import { Label } from "./ui/Label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/Select";
import { Toggle, ToggleGroup } from "./ui/ToggleGroup";

const FIELD = "flex min-w-0 flex-col gap-2";
const UNITS = { minutes: "Minutes", hours: "Hours", days: "Days" } as const;
type IUnit = keyof typeof UNITS;
const wallClock = () => new Date();

// Follows CustomSnoozeDialog in apps/web/src/components/CustomSnoozeDialog.tsx.
export function CustomSnoozeDialog(props: {
  onSnooze: (snoozedUntil: string) => void;
  onClose: () => void;
}) {
  const environment = Environment.use();
  const id = createUniqueId();
  const today = () => localSnoozeDate(new Date(environment.minute()));
  const initial = new Date(environment.minute() + 3_600_000);
  const [mode, setMode] = createSignal<CustomSnoozeInput["mode"]>("date");
  const [date, setDate] = createSignal(localSnoozeDate(initial));
  const [time, setTime] = createSignal(localSnoozeTime(initial));
  const [amount, setAmount] = createSignal("2");
  const [unit, setUnit] = createSignal<IUnit>("hours");
  const [error, setError] = createSignal<string | null>(null);
  const input = (): CustomSnoozeInput =>
    mode() === "date"
      ? { mode: "date", date: date(), time: time() }
      : { mode: "duration", amount: amount(), unit: unit() };
  const edited =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setError(null);
    };
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const snoozedUntil = resolveCustomSnooze(input(), wallClock());
    if (snoozedUntil === null) {
      setError(
        mode() === "date"
          ? "Choose a valid date and time in the future."
          : "Enter a positive duration.",
      );
      return;
    }
    props.onClose();
    props.onSnooze(snoozedUntil);
  };
  return (
    <Dialog onClose={props.onClose}>
      <DialogPopup size="md">
        <form class="flex min-h-0 flex-col" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Custom snooze</DialogTitle>
            <DialogDescription>Choose when snoozed threads return to your inbox.</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div class="flex flex-col gap-4">
              <ToggleGroup
                aria-label="Schedule type"
                class="w-full *:flex-1"
                value={[mode()]}
                onValueChange={(next) => {
                  const value = next[0];
                  if (value === "date" || value === "duration") edited(setMode)(value);
                }}
              >
                <Toggle value="date">Date and time</Toggle>
                <Toggle value="duration">Duration</Toggle>
              </ToggleGroup>
              <Show
                when={mode() === "date"}
                fallback={
                  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div class={FIELD}>
                      <Label for={`${id}-amount`}>Snooze for</Label>
                      <Input
                        id={`${id}-amount`}
                        type="number"
                        min="0"
                        step="any"
                        required
                        value={amount()}
                        onInput={(event) => edited(setAmount)(event.currentTarget.value)}
                      />
                    </div>
                    <div class={FIELD}>
                      <Label for={`${id}-unit`}>Unit</Label>
                      <Select
                        value={unit()}
                        onValueChange={(value) => {
                          if (value in UNITS) edited(setUnit)(value as IUnit);
                        }}
                      >
                        <SelectTrigger id={`${id}-unit`} class="min-w-0">
                          <SelectValue>{UNITS[unit()]}</SelectValue>
                        </SelectTrigger>
                        <SelectPopup>
                          <SelectItem value="minutes">Minutes</SelectItem>
                          <SelectItem value="hours">Hours</SelectItem>
                          <SelectItem value="days">Days</SelectItem>
                        </SelectPopup>
                      </Select>
                    </div>
                  </div>
                }
              >
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div class={FIELD}>
                    <Label for={`${id}-date`}>Date</Label>
                    <Input
                      id={`${id}-date`}
                      type="date"
                      required
                      min={today()}
                      value={date()}
                      onInput={(event) => edited(setDate)(event.currentTarget.value)}
                    />
                  </div>
                  <div class={FIELD}>
                    <Label for={`${id}-time`}>Time</Label>
                    <Input
                      id={`${id}-time`}
                      type="time"
                      required
                      value={time()}
                      onInput={(event) => edited(setTime)(event.currentTarget.value)}
                    />
                  </div>
                </div>
              </Show>
            </div>
            <Show when={error()}>
              {(message) => (
                <p role="alert" class="text-destructive">
                  {message()}
                </p>
              )}
            </Show>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={props.onClose}>
              Cancel
            </Button>
            <Button type="submit">Snooze</Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
