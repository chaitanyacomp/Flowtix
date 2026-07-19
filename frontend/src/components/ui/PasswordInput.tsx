import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "./button";
import { Input } from "./input";
import { cn } from "../../lib/utils";
import {
  nextPasswordVisible,
  passwordInputType,
  passwordVisibilityToggleLabel,
} from "../../lib/passwordVisibility";

export type PasswordInputProps = Omit<React.ComponentPropsWithoutRef<typeof Input>, "type"> & {
  /** Optional id for the toggle control (defaults from input id). */
  toggleId?: string;
};

/**
 * Password field with an accessible show/hide control.
 * Toggle uses type="button" so it never submits the surrounding form.
 */
export const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, toggleId, id, ...props }, ref) => {
    const [visible, setVisible] = React.useState(false);
    const resolvedToggleId = toggleId ?? (id ? `${id}-visibility` : undefined);
    const label = passwordVisibilityToggleLabel(visible);

    return (
      <div className="relative" data-testid="password-input">
        <Input
          {...props}
          id={id}
          ref={ref}
          type={passwordInputType(visible)}
          className={cn("pr-11", className)}
        />
        <Button
          id={resolvedToggleId}
          type="button"
          variant="ghost"
          size="icon"
          className="absolute inset-y-0 right-0 my-auto mr-1 h-9 w-9 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          aria-label={label}
          aria-pressed={visible}
          aria-controls={id}
          title={label}
          data-testid="password-visibility-toggle"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setVisible((v) => nextPasswordVisible(v));
          }}
          onMouseDown={(e) => {
            // Keep focus on the password field when clicking the eye.
            e.preventDefault();
          }}
        >
          {visible ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
        </Button>
      </div>
    );
  },
);
PasswordInput.displayName = "PasswordInput";
