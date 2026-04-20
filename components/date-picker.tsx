"use client";
import { ChevronDownIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useState, type Dispatch } from "react";
import { formatTanggal } from "@/lib/utils";
import { cn } from "@/lib/utils";

type DatePickerProps = {
  value?: Date;
  onChange?: Dispatch<Date | undefined>;
  placeholder?: string;
  className?: string;
};

export function DatePicker({
  value,
  onChange,
  placeholder,
  className,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          id="date"
          className={cn("w-full justify-between font-normal", className)}
        >
          {value
            ? formatTanggal(value.toLocaleDateString("id-ID"))
            : placeholder
              ? placeholder
              : "Pilih tanggal"}
          <ChevronDownIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto overflow-hidden p-0"
        align="start"
        side="bottom"
      >
        <Calendar
          mode="single"
          selected={value}
          captionLayout="dropdown"
          onSelect={(date: Date | undefined) => {
            onChange?.(date);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
