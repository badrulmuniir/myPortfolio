import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FormField } from './FormField.jsx';

describe('FormField', () => {
  it('associates a visible label and sets no error wiring without an error', () => {
    render(
      <FormField id="name" label="Name">
        {(p) => <input {...p} className="form-control" defaultValue="Jane" />}
      </FormField>,
    );
    const input = screen.getByLabelText('Name');
    expect(input.id).toBe('name');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(input.hasAttribute('aria-describedby')).toBe(false);
    expect(document.getElementById('name-error')).toBeNull();
  });

  it('connects the error with aria-describedby and sets aria-invalid', () => {
    render(
      <FormField id="email" label="Email" error="Enter a valid email address">
        {(p) => <input {...p} />}
      </FormField>,
    );
    const input = screen.getByLabelText('Email');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('email-error');
    expect(document.getElementById('email-error').textContent).toBe('Enter a valid email address');
  });

  it('lists hint and error ids together and keeps the hint without an error', () => {
    const { rerender } = render(
      <FormField id="msg" label="Message" hint="10 to 5000 characters" error="Too short">
        {(p) => <textarea {...p} />}
      </FormField>,
    );
    const textarea = screen.getByLabelText('Message');
    expect(textarea.tagName).toBe('TEXTAREA');
    expect(textarea.getAttribute('aria-describedby')).toBe('msg-hint msg-error');

    rerender(
      <FormField id="msg" label="Message" hint="10 to 5000 characters">
        {(p) => <textarea {...p} />}
      </FormField>,
    );
    expect(textarea.getAttribute('aria-describedby')).toBe('msg-hint');
    expect(textarea.hasAttribute('aria-invalid')).toBe(false);
    expect(document.getElementById('msg-error')).toBeNull();
  });

  it('works with a select and shows a visible required marker', () => {
    render(
      <FormField id="level" label="Level" required>
        {(p) => (
          <select {...p}>
            <option value="">None</option>
          </select>
        )}
      </FormField>,
    );
    const select = screen.getByRole('combobox');
    expect(select.id).toBe('level');
    expect(select.getAttribute('aria-required')).toBe('true');
    expect(select.hasAttribute('required')).toBe(false);
    expect(document.querySelector('label[for="level"]').textContent).toContain('(required)');
  });
});
