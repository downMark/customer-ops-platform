import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { CalendarIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface DateTimePickerProps {
  date?: Date;
  time: string;
  onDateChange: (date?: Date) => void;
  onTimeChange: (time: string) => void;
  disabled?: boolean;
  invalid?: boolean;
}

export function DateTimePicker({
  date,
  time,
  onDateChange,
  onTimeChange,
  disabled,
  invalid,
}: DateTimePickerProps) {
  const clear = () => {
    onDateChange(undefined);
    onTimeChange("");
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            aria-invalid={invalid}
            className={cn(
              "w-full justify-start text-left text-base font-normal sm:w-56",
              !date && "text-muted-foreground",
              invalid && "border-destructive",
            )}
          >
            <CalendarIcon className="h-4 w-4" />
            {date ? format(date, "yyyy年MM月dd日") : "选择日期"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-3" align="start">
          <Calendar
            mode="single"
            selected={date}
            onSelect={onDateChange}
            locale={zhCN}
            initialFocus
          />
        </PopoverContent>
      </Popover>
      <Input
        type="time"
        value={time}
        disabled={disabled}
        aria-invalid={invalid}
        onChange={(event) => onTimeChange(event.target.value)}
        className="w-full sm:w-36"
        aria-label="预计送达时间"
      />
      {(date || time) && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          onClick={clear}
          aria-label="清空预计送达时间"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
