using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OpenHarvest.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddEntityTags : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string[]>(
                name: "Tags",
                table: "garden_entities",
                type: "text[]",
                nullable: false,
                defaultValue: new string[0]);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Tags",
                table: "garden_entities");
        }
    }
}
