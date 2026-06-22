// eslint-disable-next-line
frappe.query_reports["ESS Attendance Report"] = {
  filters: [
    {
      fieldname: "from_date",
      label: "From Date",
      fieldtype: "Date",
      default: frappe.datetime.month_start(),
      reqd: 1,
    },
    {
      fieldname: "to_date",
      label: "To Date",
      fieldtype: "Date",
      default: frappe.datetime.month_end(),
      reqd: 1,
    },
    {
      fieldname: "employee",
      label: "Employee",
      fieldtype: "Link",
      options: "Employee",
    },
    {
      fieldname: "project",
      label: "Project",
      fieldtype: "Link",
      options: "Project",
    },
    {
      fieldname: "status",
      label: "Status",
      fieldtype: "Select",
      options: ["", "Present", "Absent", "Pending Approval", "Checked In", "Missed Checkout"].join("\n"),
    },
  ],
  formatter: function (value, row, column, data, default_formatter) {
    value = default_formatter(value, row, column, data);
    if (column.fieldname === "status" && data) {
      const colors = {
        Present: "green", Absent: "red", "Pending Approval": "orange",
        "Checked In": "blue", "Missed Checkout": "purple",
      };
      const c = colors[data.status];
      if (c) value = `<span class="indicator-pill ${c}">${data.status}</span>`;
    }
    if ((column.fieldname === "check_in_zone" || column.fieldname === "check_out_zone") && value === "Outside") {
      value = `<span style="color: var(--orange-600, #b45309); font-weight:600">Outside</span>`;
    }
    return value;
  },
};
