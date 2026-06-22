// eslint-disable-next-line
frappe.query_reports["ESS Overtime Summary"] = {
  filters: [
    { fieldname: "from_date", label: "From Date", fieldtype: "Date", default: frappe.datetime.month_start(), reqd: 1 },
    { fieldname: "to_date", label: "To Date", fieldtype: "Date", default: frappe.datetime.month_end(), reqd: 1 },
    { fieldname: "employee", label: "Employee", fieldtype: "Link", options: "Employee" },
    { fieldname: "project", label: "Project", fieldtype: "Link", options: "Project" },
  ],
};
