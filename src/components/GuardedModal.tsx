import { useState } from 'react'
import { Button, Group, Modal, Text, type ModalProps } from '@mantine/core'

type Props = Omit<ModalProps, 'opened'> & { dirty: boolean }

/** Modal that asks "Discard changes?" before closing when `dirty`. Saving should call the parent's onClose directly, not go through here. */
export function GuardedModal({ dirty, onClose, children, ...rest }: Props) {
  const [asking, setAsking] = useState(false)
  const tryClose = () => (dirty ? setAsking(true) : onClose())

  return (
    <>
      <Modal opened onClose={tryClose} {...rest}>
        {children}
      </Modal>
      <Modal opened={asking} onClose={() => setAsking(false)} title="Discard changes?" centered size="sm" withCloseButton={false} zIndex={400}>
        <Text size="sm" mb="md">Your edits will be lost.</Text>
        <Group grow>
          <Button variant="default" data-autofocus onClick={() => setAsking(false)}>Keep editing</Button>
          <Button color="red" onClick={onClose}>Discard</Button>
        </Group>
      </Modal>
    </>
  )
}

/** True once `state` differs from what it was on the first render. */
export function useDirty(state: unknown) {
  const [initial] = useState(() => JSON.stringify(state))
  return JSON.stringify(state) !== initial
}
