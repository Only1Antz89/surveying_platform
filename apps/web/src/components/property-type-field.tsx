import { propertyTypeOptions } from "@/lib/property-artwork";

/** Manual descriptions remain valid; suggestions only help choose a matching illustration. */
export function PropertyTypeField({ id, defaultValue = "" }: { id: string; defaultValue?: string }) {
  return <div className="field">
    <label htmlFor={id}>Property / land type</label>
    <input id={id} name="propertyType" className="input" maxLength={100} defaultValue={defaultValue} list={`${id}-options`} aria-describedby={`${id}-help`} placeholder="Choose a suggested type or enter your own" />
    <datalist id={`${id}-options`}>{propertyTypeOptions.map(option => <option key={option.artwork} value={option.label} />)}</datalist>
    <span id={`${id}-help`} className="form-help">The recorded type selects matching illustrative artwork. Custom descriptions are welcome.</span>
  </div>;
}
