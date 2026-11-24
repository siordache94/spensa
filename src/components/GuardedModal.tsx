import { useEffect, useRef, useState } from 'react'
import { Button, Group, Modal, Text, type ModalProps } from '@mantine/core'
import { useModalOverlay, useOverlay } from '../lib/navigation.ts'

type Props = Omit<ModalProps, 'opened'> & { dirty: boolean }

/**
 * Modal that asks "Discard changes?" before closing when `dirty`. Saving should call the parent's onClose directly,
 * not go through here. Open modals are part of the history layer (MR-051): phone back closes this one first, and a
 * dirty form turns that back into the same "Keep editing / Discard" question.
 */
export function GuardedModal({ dirty, onClose, children, ...rest }: Props) {
  const [asking, setAsking] = useState(false)
  const dirtyRef = useRef(dirty)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    dirtyRef.current = dirty
    onCloseRef.current = onClose
  })

  const overlay = useOverlay(() => {
    if (dirtyRef.current) {
      setAsking(true)
      return 'stayed'
    }
    onCloseRef.current()
    return 'closed'
  })

  const tryClose = () => {
    if (dirty) {
      setAsking(true)
      return
    }
    overlay.close()
    onClose()
  }

  return (
    <>
      <Modal opened onClose={tryClose} {...rest}>
        {children}
      </Modal>
      {asking && (
        <AskingModal
          onKeep={() => setAsking(false)}
          onDiscard={() => {
            setAsking(false)
            onClose()
          }}
        />
      )}
    </>
  )
}

/** The nested question is an overlay of its own, so back answers it exactly like the Keep editing button. */
function AskingModal({ onKeep, onDiscard }: { onKeep: () => void; onDiscard: () => void }) {
  const close = useModalOverlay(onKeep)
  return (
    <Modal opened onClose={close} title="Discard changes?" centered size="sm" withCloseButton={false} zIndex={400}>
      <Text size="sm" mb="md">Your edits will be lost.</Text>
      <Group grow>
        <Button variant="default" data-autofocus onClick={close}>Keep editing</Button>
        <Button color="red" onClick={onDiscard}>Discard</Button>
      </Group>
    </Modal>
  )
}

/** True once `state` differs from what it was on the first render. */
export function useDirty(state: unknown) {
  const [initial] = useState(() => JSON.stringify(state))
  return JSON.stringify(state) !== initial
}
