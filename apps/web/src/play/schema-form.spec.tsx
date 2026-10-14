import { fireEvent, render, screen } from '@testing-library/react';
import { defaultValue, humanize, type Schema, SchemaForm } from './schema-form';

// The shape of PlayerTurn, cut down.
const turn: Schema = {
  type: 'object',
  title: 'PlayerTurn',
  properties: {
    situation_assessment: { type: 'string', description: 'What you believe is happening.' },
    orders: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          unit: { type: 'string' },
          order: { type: 'string' },
          delivery: { type: 'string', enum: ['light', 'instant'] },
        },
      },
    },
    confident: { type: 'boolean' },
    rating: { type: 'integer', minimum: 1, maximum: 5 },
  },
};

describe('defaultValue', () => {
  it('builds an empty value of the right shape', () => {
    expect(defaultValue(turn)).toEqual({ situation_assessment: '', orders: [], confident: false, rating: 1 });
  });
});

describe('humanize', () => {
  it('turns snake_case keys into labels', () => {
    expect(humanize('instant_intel_requests')).toBe('Instant intel requests');
  });
});

describe('SchemaForm', () => {
  it('turns what is entered into a reply of the schema shape', () => {
    const onSubmit = vi.fn();
    render(<SchemaForm schema={turn} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('Situation assessment'), { target: { value: 'Quiet so far' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to orders' }));
    fireEvent.change(screen.getByLabelText('Unit'), { target: { value: 'blue-raider' } });
    fireEvent.change(screen.getByLabelText('Order'), { target: { value: 'MoveTo(0, -3)' } });
    fireEvent.change(screen.getByLabelText('Delivery'), { target: { value: 'instant' } });
    fireEvent.click(screen.getByLabelText('Confident'));
    fireEvent.change(screen.getByLabelText('Rating'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(onSubmit).toHaveBeenCalledWith({
      situation_assessment: 'Quiet so far',
      orders: [{ unit: 'blue-raider', order: 'MoveTo(0, -3)', delivery: 'instant' }],
      confident: true,
      rating: 4,
    });
  });

  it('starts from given values, and items can be removed', () => {
    const onSubmit = vi.fn();
    const initial = { situation_assessment: 'Before', orders: [{ unit: 'a', order: 'Hold', delivery: 'light' }], confident: false, rating: 2 };
    render(<SchemaForm schema={turn} initial={initial} onSubmit={onSubmit} />);

    expect(screen.getByLabelText('Situation assessment')).toHaveProperty('value', 'Before');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSubmit).toHaveBeenCalledWith({ ...initial, orders: [] });
  });
});
