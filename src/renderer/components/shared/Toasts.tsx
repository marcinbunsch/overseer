import { observer } from "mobx-react-lite"
import * as Toast from "@radix-ui/react-toast"
import { toastStore } from "../../stores/ToastStore"

export const Toasts = observer(function Toasts() {
  return (
    <Toast.Provider duration={3000}>
      {toastStore.toasts.map((t) => (
        <Toast.Root
          key={t.id}
          open
          onOpenChange={(open) => {
            if (!open) toastStore.dismiss(t.id)
          }}
          className="rounded-lg border border-ovr-border-subtle bg-ovr-bg-panel px-4 py-3 text-sm text-ovr-text-primary shadow-ovr-panel data-[state=closed]:animate-[toast-hide_200ms_ease-in] data-[state=open]:animate-[toast-show_200ms_ease-out] data-[swipe=end]:animate-[toast-hide_200ms_ease-in]"
        >
          <Toast.Title>{t.message}</Toast.Title>
        </Toast.Root>
      ))}
      <Toast.Viewport className="fixed top-4 left-1/2 z-100 flex -translate-x-1/2 flex-col items-center gap-2" />
    </Toast.Provider>
  )
})
