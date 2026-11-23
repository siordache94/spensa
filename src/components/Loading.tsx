import { Center, Loader, VisuallyHidden } from '@mantine/core'

/** A centred spinner that announces `label` to screen readers. */
export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <Center py="xl" role="status">
      <Loader />
      <VisuallyHidden>{label}</VisuallyHidden>
    </Center>
  )
}
