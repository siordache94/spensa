import {
  Accordion, ActionIcon, Autocomplete, Badge, Button, Card, Checkbox, Combobox, Drawer, Input, InputWrapper, Menu, Modal, MultiSelect, type MantineColorsTuple,
  Paper, Popover, SegmentedControl, Select, TagsInput, createTheme,
} from '@mantine/core'
import './theme.css'

// Softened alert yellow, #F5CC3B at shade 5.
const yellow: MantineColorsTuple = [
  '#fff8dc', '#fdefb5', '#fae488', '#f8da61', '#f6d14c', '#f5cc3b', '#d9b02a', '#b58f1c', '#8a6c12', '#5e490b',
]

// Dropdowns stay put: no flip/shift (they oscillate when the soft keyboard resizes the viewport) and no fade.
const comboboxProps = {
  position: 'bottom' as const,
  middlewares: { flip: false, shift: false },
  transitionProps: { duration: 0 },
}

const label = '"Barlow Semi Condensed", "Arial Narrow", sans-serif'

export const theme = createTheme({
  colors: { yellow },
  primaryColor: 'yellow',
  primaryShade: 5,
  autoContrast: true,
  luminanceThreshold: 0.4,
  fontFamily: '"Schibsted Grotesk", system-ui, sans-serif',
  headings: { fontFamily: label, fontWeight: '600' },
  defaultRadius: 'sm', // 8px for inputs and buttons
  radius: { xs: '4px', sm: '8px', md: '12px', lg: '12px', xl: '16px' },
  other: { labelFont: label },
  components: {
    Paper: Paper.extend({ defaultProps: { radius: 'md' }, classNames: { root: 'sp-panel' } }),
    Card: Card.extend({ defaultProps: { radius: 'md', shadow: undefined }, classNames: { root: 'sp-panel' } }),
    Modal: Modal.extend({
      defaultProps: { radius: 'md', centered: true },
      classNames: { content: 'sp-overlay-content', header: 'sp-modal-header', title: 'sp-heading' },
    }),
    Drawer: Drawer.extend({
      classNames: { content: 'sp-overlay-content', header: 'sp-modal-header', title: 'sp-heading' },
    }),
    Input: Input.extend({ classNames: { input: 'sp-input' } }),
    InputWrapper: InputWrapper.extend({ classNames: { label: 'sp-input-label' } }),
    Popover: Popover.extend({ classNames: { dropdown: 'sp-overlay-content' } }),
    Select: Select.extend({ defaultProps: { comboboxProps } }),
    Autocomplete: Autocomplete.extend({ defaultProps: { comboboxProps } }),
    MultiSelect: MultiSelect.extend({ defaultProps: { comboboxProps } }),
    TagsInput: TagsInput.extend({ defaultProps: { comboboxProps } }),
    Combobox: Combobox.extend({ defaultProps: comboboxProps, classNames: { dropdown: 'sp-overlay-content' } }),
    Menu: Menu.extend({
      defaultProps: { shadow: undefined },
      classNames: { dropdown: 'sp-overlay-content', item: 'sp-menu-item', divider: 'sp-menu-divider' },
    }),
    SegmentedControl: SegmentedControl.extend({
      defaultProps: { radius: 'sm' },
      classNames: { root: 'sp-seg-root', indicator: 'sp-seg-indicator', label: 'sp-seg-label' },
    }),
    Checkbox: Checkbox.extend({
      defaultProps: { radius: 4, size: 'var(--tick)' },
      classNames: { root: 'sp-checkbox-root', input: 'sp-checkbox-input' },
    }),
    Badge: Badge.extend({ classNames: { root: 'sp-badge' } }),
    Button: Button.extend({ classNames: { root: 'sp-button' } }),
    ActionIcon: ActionIcon.extend({ defaultProps: { radius: 'sm' } }),
    Accordion: Accordion.extend({
      classNames: { item: 'sp-acc-item', control: 'sp-acc-control', label: 'sp-acc-label' },
    }),
  },
})
