"use client"

import {
  RiCheckboxCircleFill,
  RiInformationFill,
  RiLoader4Line,
  RiCloseCircleFill,
  RiAlertFill,
} from "@remixicon/react"
import { useTheme } from "next-themes"
import { Toaster as Sonner } from "sonner"

type ToasterProps = React.ComponentProps<typeof Sonner>
type Theme = NonNullable<ToasterProps["theme"]>

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme()
  const resolved: Theme =
    theme === "light" || theme === "dark" ? theme : "system"

  return (
    <Sonner
      theme={resolved}
      className="toaster group"
      icons={{
        success: <RiCheckboxCircleFill size={16} />,
        info: <RiInformationFill size={16} />,
        warning: <RiAlertFill size={16} />,
        error: <RiCloseCircleFill size={16} />,
        loading: <RiLoader4Line size={16} className="animate-spin" />,
      }}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
