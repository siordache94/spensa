import { Button, Stack } from '@mantine/core'
import { Link } from 'react-router'
import './lists.css'

/** A real page inside the shell for an unknown path, instead of an empty board (MR-033). */
export default function NotFound() {
  return (
    <Stack className="sp-narrow" gap="md">
      <h1 className="sp-title">Page not found</h1>
      <p className="sp-dim">That link doesn't lead anywhere in Spensa.</p>
      <Button component={Link} to="/" w="fit-content">Back to Plan</Button>
    </Stack>
  )
}
