namespace OpenHarvest.Domain.ValueObjects;

public record Quaternion(double X, double Y, double Z, double W)
{
    public static Quaternion Identity { get; } = new(0, 0, 0, 1);
}
