"use client";

import { DatePicker } from "@/components/date-picker";

type DatePickerStringProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
};

function toYmd(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseYmd(value: string): Date | undefined {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  return new Date(year, month - 1, day);
}

export function DatePickerString({
  value,
  onChange,
  placeholder,
  className,
}: DatePickerStringProps) {
  return (
    <DatePicker
      value={parseYmd(value)}
      onChange={(date) => onChange(date ? toYmd(date) : "")}
      placeholder={placeholder}
      className={className}
    />
  );
}
