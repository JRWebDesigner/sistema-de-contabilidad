"use client";

import { FormEvent, useEffect, useState } from "react";
import { Eye, Plus, Search, UserRound } from "lucide-react";

import Modal from "./ui/modal";
import AccountStatementModal from "./account-statement-modal";
import { usePermission } from "./permissions-context";

type Customer = {
  id: string;
  type: "PERSON" | "COMPANY";
  document: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  isActive: boolean;
  documentNumber?: string | null;
  nit?: string | null;
  alias?: string | null;
  observation?: string | null;
  billingData?: Record<string, unknown> | null;
  branches?: unknown;
  legalRepresentatives?: unknown;
  communicationPhones?: unknown;
  communicationEmails?: unknown;
  socialNetworks?: unknown;
  contacts?: unknown;
  credit?: boolean;
  paymentDays?: number | null;
  creditLimit?: string | number | null;
  priceListId?: string | null;
  priceList?: { name: string } | null;
  firstSale?: string | null;
  accountingReference?: string | null;
  addresses?: unknown;
  attachments?: unknown;
  createdAt?: string;
  updatedAt?: string;
};

type CustomerForm = {
  type: "PERSON" | "COMPANY";
  nit: string;
  documentNumber: string;
  name: string;
  alias: string;
  observation: string;
  billingName: string;
  billingDocument: string;
  branches: string[];
  legalRepresentatives: string[];
  phones: string[];
  emails: string;
  socialNetworks: string;
  contacts: string;
  credit: boolean;
  paymentDays: string;
  creditLimit: string;
  priceListId: string;
  firstSale: string;
  accountingReference: string;
  addressLabel: string;
  latitude: string;
  longitude: string;
  attachments: string;
};

const emptyForm: CustomerForm = {
  type: "PERSON",
  nit: "",
  documentNumber: "",
  name: "",
  alias: "",
  observation: "",
  billingName: "",
  billingDocument: "",
  branches: [],
  legalRepresentatives: [""],
  phones: [""],
  emails: "",
  socialNetworks: "",
  contacts: "",
  credit: false,
  paymentDays: "",
  creditLimit: "",
  priceListId: "",
  firstSale: "",
  accountingReference: "",
  addressLabel: "",
  latitude: "-16.5000",
  longitude: "-68.1500",
  attachments: "",
};

function lines(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function customerToForm(customer: Customer): CustomerForm {
  const billingData = customer.billingData && typeof customer.billingData === "object" ? customer.billingData : {};
  const firstAddress = listValues(customer.addresses)[0];
  const address = typeof firstAddress === "object" && firstAddress !== null
    ? firstAddress as { label?: string; latitude?: number; longitude?: number }
    : { label: typeof firstAddress === "string" ? firstAddress : customer.address ?? "" };
  return {
    ...emptyForm,
    type: customer.type,
    nit: customer.nit ?? "",
    documentNumber: customer.documentNumber ?? customer.document,
    name: customer.name,
    alias: customer.alias ?? "",
    observation: customer.observation ?? "",
    billingName: typeof billingData.name === "string" ? billingData.name : "",
    billingDocument: typeof billingData.document === "string" ? billingData.document : "",
    branches: listValues(customer.branches).map(String).filter((id) => id !== customer.id),
    legalRepresentatives: listValues(customer.legalRepresentatives).map(String).filter(Boolean).length
      ? listValues(customer.legalRepresentatives).map(String).filter(Boolean)
      : [""],
    phones: listValues(customer.communicationPhones).map(String).filter(Boolean).length
      ? listValues(customer.communicationPhones).map(String).filter(Boolean)
      : [customer.phone ?? ""],
    emails: listValues(customer.communicationEmails).map(String).join("\n") || customer.email || "",
    socialNetworks: listValues(customer.socialNetworks).map(String).join("\n"),
    contacts: listValues(customer.contacts).map(String).join("\n"),
    credit: customer.credit ?? false,
    paymentDays: customer.paymentDays == null ? "" : String(customer.paymentDays),
    creditLimit: customer.creditLimit == null ? "" : String(customer.creditLimit),
    priceListId: customer.priceListId ?? "",
    firstSale: customer.firstSale ? new Date(customer.firstSale).toISOString().slice(0, 10) : "",
    accountingReference: customer.accountingReference ?? "",
    addressLabel: address.label ?? "",
    latitude: address.latitude == null ? "-16.5000" : String(address.latitude),
    longitude: address.longitude == null ? "-68.1500" : String(address.longitude),
    attachments: listValues(customer.attachments).map(String).join("\n"),
  };
}

function listValues(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function displayValue(value: unknown, empty = "Sin información") {
  if (value === null || value === undefined || value === "") return empty;
  if (Array.isArray(value))
    return value.length ? value.map(String).join(", ") : empty;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function DetailField({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="customer-detail-field">
      <span>{label}</span>
      <strong>{displayValue(value)}</strong>
    </div>
  );
}

function CustomerDetails({
  customer,
  customers,
}: {
  customer: Customer;
  customers: Customer[];
}) {
  const branchIds = listValues(customer.branches).map(String);
  const branches = branchIds.map(
    (id) => customers.find((item) => item.id === id)?.name ?? id,
  );
  const addresses = listValues(customer.addresses).map((address) => {
    if (typeof address === "object" && address !== null) {
      const item = address as {
        label?: string;
        latitude?: number;
        longitude?: number;
      };
      return `${item.label || "Dirección"} (${item.latitude ?? "-"}, ${item.longitude ?? "-"})`;
    }
    return String(address);
  });

  return (
    <div className="customer-details">
      <section className="customer-detail-section">
        <h3>Identificación</h3>
        <div className="customer-detail-grid">
          <DetailField
            label="Tipo de cliente"
            value={customer.type === "COMPANY" ? "Empresa" : "Persona"}
          />
          <DetailField label="DocumentoNIT" value={customer.nit} />
          <DetailField
            label="Nro. de documento"
            value={customer.documentNumber || customer.document}
          />
          <DetailField label="Razón social" value={customer.name} />
          <DetailField label="Alias" value={customer.alias} />
          <DetailField label="Observación" value={customer.observation} />
          <DetailField
            label="Estado"
            value={customer.isActive ? "Activo" : "Inactivo"}
          />
          <DetailField
            label="Creado"
            value={
              customer.createdAt
                ? new Date(customer.createdAt).toLocaleString("es-BO")
                : null
            }
          />
          <DetailField
            label="Actualizado"
            value={
              customer.updatedAt
                ? new Date(customer.updatedAt).toLocaleString("es-BO")
                : null
            }
          />
        </div>
      </section>
      <section className="customer-detail-section">
        <h3>Datos para facturar</h3>
        <div className="customer-detail-grid">
          <DetailField
            label="Razón social"
            value={customer.billingData?.name}
          />
          <DetailField
            label="Documento"
            value={customer.billingData?.document}
          />
        </div>
      </section>
      <section className="customer-detail-section">
        <h3>Filiales y representantes legales</h3>
        <div className="customer-detail-grid">
          <DetailField label="Filiales" value={branches} />
          <DetailField
            label="Representantes legales"
            value={customer.legalRepresentatives}
          />
        </div>
      </section>
      <section className="customer-detail-section">
        <h3>Datos de comunicación</h3>
        <div className="customer-detail-grid">
          <DetailField
            label="Teléfonos"
            value={customer.communicationPhones || customer.phone}
          />
          <DetailField
            label="Email"
            value={customer.communicationEmails || customer.email}
          />
          <DetailField label="Redes sociales" value={customer.socialNetworks} />
          <DetailField label="Contactos" value={customer.contacts} />
        </div>
      </section>
      <section className="customer-detail-section">
        <h3>Condiciones para venta y pago</h3>
        <div className="customer-detail-grid">
          <DetailField label="Crédito" value={customer.credit ? "Sí" : "No"} />
          <DetailField label="Días de pago" value={customer.paymentDays} />
          <DetailField label="Límite de crédito Bs" value={customer.creditLimit} />
          <DetailField
            label="Segmento de precios"
            value={customer.priceList?.name ?? "Precio general del catálogo"}
          />
          <DetailField
            label="Primera venta"
            value={
              customer.firstSale
                ? new Date(customer.firstSale).toLocaleDateString("es-BO")
                : null
            }
          />
        </div>
      </section>
      <section className="customer-detail-section">
        <h3>Datos contables</h3>
        <div className="customer-detail-grid">
          <DetailField
            label="Cuenta de referencia contable"
            value={customer.accountingReference}
          />
        </div>
      </section>
      <section className="customer-detail-section">
        <h3>Datos de ubicación</h3>
        <div className="customer-detail-grid">
          <DetailField
            label="Dirección"
            value={addresses.length ? addresses : customer.address}
          />
        </div>
      </section>
      <section className="customer-detail-section">
        <h3>Archivos adjuntos</h3>
        <div className="customer-detail-grid">
          <DetailField
            label="Archivos o enlaces"
            value={customer.attachments}
          />
        </div>
      </section>
    </div>
  );
}

const MAP_ZOOM = 15;
const TILE_SIZE = 256;

function longitudeToPixel(longitude: number) {
  return ((longitude + 180) / 360) * (2 ** MAP_ZOOM * TILE_SIZE);
}
function latitudeToPixel(latitude: number) {
  const radians = (latitude * Math.PI) / 180;
  return (
    ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) *
    (2 ** MAP_ZOOM * TILE_SIZE)
  );
}
function pixelToCoordinates(x: number, y: number) {
  const worldSize = 2 ** MAP_ZOOM * TILE_SIZE;
  const longitude = (x / worldSize) * 360 - 180;
  const mercator = Math.PI - (2 * Math.PI * y) / worldSize;
  const latitude = (180 / Math.PI) * Math.atan(Math.sinh(mercator));
  return { latitude, longitude };
}

function LocationPicker({
  latitude,
  longitude,
  onChange,
}: {
  latitude: string;
  longitude: string;
  onChange: (latitude: number, longitude: number) => void;
}) {
  const mapWidth = 420;
  const mapHeight = 230;
  const centerX = longitudeToPixel(Number(longitude) || -68.15);
  const centerY = latitudeToPixel(Number(latitude) || -16.5);
  const tileX = Math.floor(centerX / TILE_SIZE);
  const tileY = Math.floor(centerY / TILE_SIZE);
  const tiles = [-1, 0, 1].flatMap((offsetY) =>
    [-1, 0, 1].map((offsetX) => ({ x: tileX + offsetX, y: tileY + offsetY })),
  );
  const markerX = mapWidth / 2;
  const markerY = mapHeight / 2;

  function selectLocation(event: React.MouseEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const worldX = centerX + event.clientX - bounds.left - mapWidth / 2;
    const worldY = centerY + event.clientY - bounds.top - mapHeight / 2;
    const selected = pixelToCoordinates(worldX, worldY);
    onChange(
      Number(selected.latitude.toFixed(6)),
      Number(selected.longitude.toFixed(6)),
    );
  }

  return (
    <div className="location-picker">
      <div
        className="customer-map"
        onClick={selectLocation}
        role="application"
        aria-label="Seleccionar ubicación en el mapa"
      >
        {tiles.map((tile) => (
          <img
            key={`${tile.x}-${tile.y}`}
            src={`https://tile.openstreetmap.org/${MAP_ZOOM}/${tile.x}/${tile.y}.png`}
            alt=""
            style={{
              left: tile.x * TILE_SIZE - (centerX - mapWidth / 2),
              top: tile.y * TILE_SIZE - (centerY - mapHeight / 2),
            }}
          />
        ))}
        <span className="map-marker" style={{ left: markerX, top: markerY }} />
        <span className="map-credit">OpenStreetMap</span>
      </div>
      <p className="map-hint">
        Haz clic en el minimapa o ajusta las coordenadas.
      </p>
    </div>
  );
}

function FormSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="customer-form-section">
      <h2>{title}</h2>
      <div className="product-form-grid">{children}</div>
    </section>
  );
}

export default function CustomersModule() {
  const canWrite = usePermission("contacts:write");
  const canReadFinance = usePermission("finance:read");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [priceLists, setPriceLists] = useState<Array<{ id: string; name: string }>>([]);
  const [query, setQuery] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [form, setForm] = useState<CustomerForm>(emptyForm);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(
    null,
  );
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null);
  const [statementCustomer, setStatementCustomer] = useState<Customer | null>(null);
  const update = <K extends keyof CustomerForm>(
    key: K,
    value: CustomerForm[K],
  ) => setForm((current) => ({ ...current, [key]: value }));
  const updateList = (
    key: "legalRepresentatives" | "phones",
    index: number,
    value: string,
  ) =>
    setForm((current) => ({
      ...current,
      [key]: current[key].map((item, itemIndex) =>
        itemIndex === index ? value : item,
      ),
    }));
  const addListItem = (key: "legalRepresentatives" | "phones") =>
    setForm((current) => ({
      ...current,
      [key]: [...current[key], ""],
    }));
  const removeListItem = (
    key: "legalRepresentatives" | "phones",
    index: number,
  ) =>
    setForm((current) => ({
      ...current,
      [key]:
        current[key].length === 1
          ? [""]
          : current[key].filter((_, itemIndex) => itemIndex !== index),
    }));

  async function loadCustomers(search = query) {
    setIsLoading(true);
    try {
      const response = await fetch(
        `/api/customers?q=${encodeURIComponent(search)}`,
      );
      const data = await response.json().catch(() => ({}));
      setCustomers(response.ok && Array.isArray(data) ? data : []);
      if (!response.ok && data.error) setMessage(data.error);
    } catch {
      setCustomers([]);
      setMessage("No se pudo cargar la lista de clientes.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadCustomers("");
    fetch("/api/pricing")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "No se pudieron cargar las listas de precios.");
        if (!Array.isArray(data.priceLists)) throw new Error("La respuesta de listas de precios no es válida.");
        setPriceLists(data.priceLists);
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : "No se pudieron cargar las listas de precios."));
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const response = await fetch(editingCustomerId ? `/api/customers?id=${encodeURIComponent(editingCustomerId)}` : "/api/customers", {
      method: editingCustomerId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: form.type,
        nit: form.nit,
        documentNumber: form.documentNumber,
        name: form.name,
        alias: form.alias,
        observation: form.observation,
        billingData: { name: form.billingName, document: form.billingDocument },
        branches: form.branches,
        legalRepresentatives: form.legalRepresentatives.filter(Boolean),
        communicationPhones: form.phones.filter(Boolean),
        communicationEmails: lines(form.emails),
        socialNetworks: lines(form.socialNetworks),
        contacts: lines(form.contacts),
        credit: form.credit,
        paymentDays: form.paymentDays ? Number(form.paymentDays) : undefined,
        creditLimit: form.credit ? Number(form.creditLimit) : null,
        priceListId: form.priceListId || null,
        firstSale: form.firstSale || undefined,
        accountingReference: form.accountingReference,
        addresses: form.addressLabel.trim()
          ? [
              {
                label: form.addressLabel.trim(),
                latitude: Number(form.latitude),
                longitude: Number(form.longitude),
              },
            ]
          : undefined,
        attachments: lines(form.attachments),
      }),
    });
    const data = await response.json();

    if (!response.ok) {
      setMessage(data.error ?? "No se pudo guardar el cliente.");
      return;
    }

    setForm(emptyForm);
    setEditingCustomerId(null);
    setIsFormOpen(false);
    setMessage(editingCustomerId ? "Cliente actualizado correctamente." : "Cliente guardado exitosamente.");
    await loadCustomers();
  }

  function editCustomer(customer: Customer) {
    setEditingCustomerId(customer.id);
    setForm(customerToForm(customer));
    setMessage("");
    setIsFormOpen(true);
  }

  return (
    <div className="dashboard-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Contactos</p>
          <h1>Clientes</h1>
          <p className="muted">Directorio real de personas y empresas.</p>
        </div>
        {canWrite && <button
          className="primary-button"
          onClick={() => { setEditingCustomerId(null); setForm(emptyForm); setIsFormOpen((open) => !open); }}
        >
          <Plus size={17} /> Nuevo cliente
        </button>}
      </div>
      {message && <p className="module-message">{message}</p>}
      <Modal
        open={isFormOpen}
        onClose={() => { setIsFormOpen(false); setEditingCustomerId(null); }}
        page="Contactos"
        title={editingCustomerId ? "Editar cliente" : "Nuevo cliente"}
        description={editingCustomerId ? "Actualiza los datos registrados del cliente." : "Completa los datos generales, de comunicación y facturación."}
        className="customer-modal"
      >
        <form className="customer-form" onSubmit={handleSubmit}>
          <FormSection title="Identificación">
            <label>
              Tipo de cliente
              <select
                value={form.type}
                onChange={(event) =>
                  update("type", event.target.value as CustomerForm["type"])
                }
              >
                <option value="PERSON">Persona</option>
                <option value="COMPANY">Empresa</option>
              </select>
            </label>
            <label>
              DocumentoNIT
              <input
                value={form.nit}
                onChange={(event) => update("nit", event.target.value)}
              />
            </label>
            <label>
              Nro. de documento
              <input
                required
                value={form.documentNumber}
                onChange={(event) =>
                  update("documentNumber", event.target.value)
                }
              />
            </label>
            <label>
              Razón social
              <input
                required
                value={form.name}
                onChange={(event) => update("name", event.target.value)}
              />
            </label>
            <label>
              Alias
              <input
                value={form.alias}
                onChange={(event) => update("alias", event.target.value)}
              />
            </label>
            <label>
              Observación
              <textarea
                value={form.observation}
                onChange={(event) => update("observation", event.target.value)}
              />
            </label>
          </FormSection>
          <FormSection title="Datos para facturar">
            <label>
              Razón social de facturación
              <input
                value={form.billingName}
                onChange={(event) => update("billingName", event.target.value)}
              />
            </label>
            <label>
              Documento de facturación
              <input
                value={form.billingDocument}
                onChange={(event) =>
                  update("billingDocument", event.target.value)
                }
              />
            </label>
          </FormSection>
          <FormSection title="Filiales y representantes legales">
            <label>
              Filiales
              <select
                multiple
                value={form.branches}
                onChange={(event) =>
                  update(
                    "branches",
                    Array.from(
                      event.target.selectedOptions,
                      (option) => option.value,
                    ),
                  )
                }
              >
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name} · {customer.document}
                  </option>
                ))}
              </select>
              <small className="field-hint">
                Selecciona una o varias filiales ya creadas.
              </small>
            </label>
            <div className="repeatable-field">
              <span>Representantes legales</span>
              {form.legalRepresentatives.map((representative, index) => (
                <div className="repeatable-row" key={`representative-${index}`}>
                  <input
                    placeholder="Nombre completo"
                    value={representative}
                    onChange={(event) =>
                      updateList(
                        "legalRepresentatives",
                        index,
                        event.target.value,
                      )
                    }
                  />
                  <button
                    className="outline-button"
                    type="button"
                    onClick={() =>
                      removeListItem("legalRepresentatives", index)
                    }
                  >
                    Quitar
                  </button>
                </div>
              ))}
              <button
                className="outline-button"
                type="button"
                onClick={() => addListItem("legalRepresentatives")}
              >
                <Plus size={14} /> Agregar representante
              </button>
            </div>
          </FormSection>
          <FormSection title="Datos de comunicación">
            <div className="repeatable-field">
              <span>Teléfonos</span>
              {form.phones.map((phone, index) => (
                <div className="repeatable-row" key={`phone-${index}`}>
                  <input
                    placeholder="Número de teléfono"
                    value={phone}
                    onChange={(event) =>
                      updateList("phones", index, event.target.value)
                    }
                  />
                  <button
                    className="outline-button"
                    type="button"
                    onClick={() => removeListItem("phones", index)}
                  >
                    Quitar
                  </button>
                </div>
              ))}
              <button
                className="outline-button"
                type="button"
                onClick={() => addListItem("phones")}
              >
                <Plus size={14} /> Agregar teléfono
              </button>
            </div>
            <label>
              Email
              <textarea
                placeholder="Un email por línea"
                value={form.emails}
                onChange={(event) => update("emails", event.target.value)}
              />
            </label>
            <label>
              Redes sociales
              <textarea
                placeholder="Red o usuario por línea"
                value={form.socialNetworks}
                onChange={(event) =>
                  update("socialNetworks", event.target.value)
                }
              />
            </label>
            <label>
              Contactos
              <textarea
                placeholder="Un contacto por línea"
                value={form.contacts}
                onChange={(event) => update("contacts", event.target.value)}
              />
            </label>
          </FormSection>
          <FormSection title="Condiciones para venta y pago">
            <label>
              Segmento de precios
              <select
                value={form.priceListId}
                onChange={(event) => update("priceListId", event.target.value)}
              >
                <option value="">Precio general del catálogo</option>
                {form.priceListId && !priceLists.some((priceList) => priceList.id === form.priceListId) && (
                  <option value={form.priceListId}>
                    {customers.find((customer) => customer.id === editingCustomerId)?.priceList?.name ?? "Segmento inactivo"}
                  </option>
                )}
                {priceLists.map((priceList) => (
                  <option key={priceList.id} value={priceList.id}>{priceList.name}</option>
                ))}
              </select>
            </label>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={form.credit}
                onChange={(event) => update("credit", event.target.checked)}
              />{" "}
              Crédito
            </label>
            <label>
              Días de pago
              <input
                min="0"
                type="number"
                value={form.paymentDays}
                onChange={(event) => update("paymentDays", event.target.value)}
                placeholder="Ingrese los días"
              />
            </label>
            <label>
              Límite de crédito Bs
              <input
                min="0.01"
                step="0.01"
                type="number"
                value={form.creditLimit}
                onChange={(event) => update("creditLimit", event.target.value)}
                required={form.credit}
                disabled={!form.credit}
                placeholder="Monto máximo adeudado"
              />
            </label>
            <label>
              Primera venta
              <input
                type="date"
                value={form.firstSale}
                onChange={(event) => update("firstSale", event.target.value)}
              />
            </label>
          </FormSection>
          <FormSection title="Datos contables">
            <label>
              Cuenta de referencia contable
              <input
                value={form.accountingReference}
                onChange={(event) =>
                  update("accountingReference", event.target.value)
                }
              />
            </label>
          </FormSection>
          <FormSection title="Datos de ubicación">
            <label>
              Dirección
              <input
                value={form.addressLabel}
                onChange={(event) => update("addressLabel", event.target.value)}
                placeholder="Calle, número, zona"
              />
            </label>
            <label>
              Latitud
              <input
                type="number"
                step="any"
                min="-90"
                max="90"
                value={form.latitude}
                onChange={(event) => update("latitude", event.target.value)}
              />
            </label>
            <label>
              Longitud
              <input
                type="number"
                step="any"
                min="-180"
                max="180"
                value={form.longitude}
                onChange={(event) => update("longitude", event.target.value)}
              />
            </label>
            <LocationPicker
              latitude={form.latitude}
              longitude={form.longitude}
              onChange={(latitude, longitude) =>
                setForm((current) => ({
                  ...current,
                  latitude: String(latitude),
                  longitude: String(longitude),
                }))
              }
            />
          </FormSection>
          <FormSection title="Archivos adjuntos">
            <label>
              Archivos o enlaces
              <textarea
                placeholder="Nombre o enlace, uno por línea"
                value={form.attachments}
                onChange={(event) => update("attachments", event.target.value)}
              />
            </label>
          </FormSection>
          <button className="primary-button" type="submit">
            {editingCustomerId ? "Guardar cambios" : "Guardar cliente"}
          </button>
        </form>
      </Modal>
      <Modal
        open={selectedCustomer !== null}
        onClose={() => setSelectedCustomer(null)}
        page="Ficha del cliente"
        title={selectedCustomer?.name ?? "Cliente"}
        description="Toda la información registrada de este cliente."
        className="customer-modal customer-details-modal"
      >
        {selectedCustomer && (
          <CustomerDetails customer={selectedCustomer} customers={customers} />
        )}
      </Modal>
      {canReadFinance && statementCustomer && (
        <AccountStatementModal
          open={statementCustomer !== null}
          onClose={() => setStatementCustomer(null)}
          partyType="customer"
          partyId={statementCustomer.id}
        />
      )}
      <article className="panel module-table">
        <div className="module-toolbar">
          <div className="search-box">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                void loadCustomers(event.target.value);
              }}
              placeholder="Buscar clientes..."
            />
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Documento</th>
                <th>Correo</th>
                <th>Teléfono</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6}>Cargando clientes...</td>
                </tr>
              ) : (
                customers.map((customer) => (
                  <tr key={customer.id}>
                    <td>
                      <div className="product-cell">
                        <span className="product-thumb">
                          <UserRound size={16} />
                        </span>
                        <div>
                          <strong>{customer.name}</strong>
                          <small>
                            {customer.type === "COMPANY"
                              ? "Empresa"
                              : "Persona"}
                          </small>
                        </div>
                      </div>
                    </td>
                    <td>{customer.document}</td>
                    <td>{customer.email || "Sin correo"}</td>
                    <td>{customer.phone || "Sin teléfono"}</td>
                    <td>
                      <span className="status success">
                        <i />
                        Activo
                      </span>
                    </td>
                    <td>
                      {canReadFinance && <button className="outline-button customer-view-button" type="button" onClick={() => setStatementCustomer(customer)}>Estado de cuenta</button>}
                      {canWrite && <button
                        className="outline-button customer-view-button"
                        type="button"
                        onClick={() => editCustomer(customer)}
                        title="Editar cliente"
                      >Editar</button>}
                      <button
                        className="outline-button customer-view-button"
                        type="button"
                        onClick={() => setSelectedCustomer(customer)}
                        title="Ver información del cliente"
                      >
                        <Eye size={15} /> Ver información
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}
